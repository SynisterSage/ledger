import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Copy,
  Check,
  CheckCircle2,
  Clock3,
  ChevronDown,
  Folder,
  Inbox,
  LayoutList,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ModuleHeaderActionButton,
  ModuleHeaderSegmentedButton,
  ModuleHeaderSegmentedGroup,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import { PinActionButton } from '../Common/PinActionButton';
import { ModalOverlay } from '../Common/ModalOverlay';
import { useApi } from '../../hooks/useApi';
import { useSidebar } from '../../context/SidebarContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useWorkspaceRealtimeRefresh } from '../../hooks/useWorkspaceRealtimeRefresh';
import { useWorkspaceRouteHistory } from '../../hooks/useWorkspaceRouteHistory';

type CirclePersonTeam = {
  id: string;
  name: string;
  role?: string | null;
};

type CirclePersonSummary = {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  role: string;
  teams: CirclePersonTeam[];
  team_labels?: string[];
  open_task_count: number;
  shared_project_count: number;
  follow_up_count: number;
  waiting_on_count: number;
  is_pinned: boolean;
  last_active_at: string;
  joined_at?: string | null;
  workspace_role?: string | null;
  is_owner?: boolean;
};

type CirclePersonTask = {
  id: string;
  title: string;
  status: string;
  status_label: string;
  priority: string;
  due_date: string | null;
  due_time: string | null;
  project_id: string | null;
  project_name: string | null;
  project_status: string | null;
  project_color: string | null;
  assigned_by_user_id: string | null;
  assigned_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  is_open: boolean;
  is_overdue: boolean;
};

type CirclePersonProject = {
  id: string;
  title: string;
  status: string;
  progress: number;
  color: string;
  role: string;
  due_date: string | null;
  next_action_count: number;
  updated_at: string | null;
  created_at: string | null;
};

type CirclePersonActivity = {
  id: string;
  kind: 'task' | 'project' | 'audit';
  title: string;
  detail: string;
  timestamp: string | null;
  project_id?: string | null;
  task_id?: string | null;
};

type CirclePersonDetailPayload = {
  person: CirclePersonSummary;
  summary: {
    open_task_count: number;
    shared_project_count: number;
    follow_up_count: number;
    waiting_on_count: number;
    waiting_on_me_count: number;
    waiting_on_them_count: number;
  };
  assigned_tasks: CirclePersonTask[];
  waiting_on_me: CirclePersonTask[];
  waiting_on_them: CirclePersonTask[];
  needs_attention: CirclePersonTask[];
};

type CirclePersonProjectsPayload = {
  person: CirclePersonSummary;
  shared_projects: CirclePersonProject[];
};

type CirclePersonFollowUpsPayload = {
  available: boolean;
  items: unknown[];
  message?: string | null;
};

type CirclePersonActivityPayload = {
  person: CirclePersonSummary;
  activity: CirclePersonActivity[];
};

type CircleListTab = 'all' | 'active' | 'waiting_on' | 'shared_work' | 'pinned';
type CircleDetailTab = 'overview' | 'assigned' | 'projects' | 'followups' | 'activity';
type CircleWorkspaceSectionId =
  | 'needs_attention'
  | 'assigned_work'
  | 'shared_projects'
  | 'follow_ups'
  | 'recent_activity'
  | 'pinned_people';
type CircleDisplayMode =
  | 'name'
  | 'team'
  | 'role'
  | 'open_work'
  | 'recent_activity'
  | 'newest_active'
  | 'alphabetical';

type CircleFilters = {
  teamId: string | null;
  role: string | null;
  hasOpenTasks: boolean;
  hasSharedProjects: boolean;
  waitingOn: boolean;
  pinned: boolean;
};

type CircleComposerMode = 'task' | 'follow-up';
type CircleTaskType = 'focus' | 'short_term' | 'long_term';

const circleTheme = {
  shell:
    'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] text-[var(--ledger-text-primary)] shadow-none',
  body: 'flex min-h-0 flex-1 overflow-hidden',
  leftPane:
    'flex h-full w-[300px] min-w-[260px] max-w-[320px] shrink-0 flex-col border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)]',
  leftPaneHeader:
    'border-b border-[color:var(--ledger-border-subtle)] px-3 py-2 text-[11px] font-medium text-[var(--ledger-text-muted)]',
  leftList: 'min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 py-2',
  row: 'group flex w-full items-start gap-2 rounded-xl px-2.5 py-1.5 text-left transition hover:bg-[var(--ledger-surface-hover)]',
  rowSelected: 'bg-[var(--ledger-surface-hover)] hover:bg-[var(--ledger-surface-hover)]',
  rowTitle: 'text-[12px] font-medium leading-4 text-[var(--ledger-text-primary)]',
  rowMeta: 'text-[10px] leading-3.5 text-[var(--ledger-text-muted)]',
  rowMetaStrong: 'text-[10px] font-medium leading-3.5 text-[var(--ledger-text-secondary)]',
  content: 'min-w-0 flex-1 overflow-y-auto px-5 py-5 lg:px-6',
  contentInner: 'mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5',
  panel:
    'overflow-hidden rounded-[22px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_18px_44px_rgba(66,42,24,0.06)]',
  sectionTitle: 'text-xs font-medium text-[var(--ledger-text-primary)]',
  sectionLabel:
    'text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ledger-text-muted)]',
  sectionBody: 'space-y-0',
  emptyText: 'text-sm font-light italic text-[var(--ledger-text-muted)]',
  emptyBody: 'text-sm font-light text-[var(--ledger-text-muted)]',
  chip: 'inline-flex h-6 items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)]',
  headerMeta: 'text-[11px] text-[var(--ledger-text-muted)]',
  subtleButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  compactButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-3 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  actionButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] px-3 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  primaryButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--ledger-accent)] px-3 text-[11px] font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)]',
  mutedButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] px-3 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  sectionActionText:
    'inline-flex h-7 items-center text-[11px] font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]',
  sectionRow:
    'group grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left transition hover:bg-[var(--ledger-surface-hover)]',
};

const circleTabs: Array<{ id: CircleListTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'waiting_on', label: 'Waiting on' },
  { id: 'shared_work', label: 'Shared work' },
  { id: 'pinned', label: 'Pinned' },
];

const detailTabs: Array<{ id: CircleDetailTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'assigned', label: 'Assigned work' },
  { id: 'projects', label: 'Shared projects' },
  { id: 'followups', label: 'Follow-ups' },
  { id: 'activity', label: 'Activity' },
];

const displayModes: Array<{ id: CircleDisplayMode; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'team', label: 'Team' },
  { id: 'role', label: 'Role' },
  { id: 'open_work', label: 'Open work' },
  { id: 'recent_activity', label: 'Recent activity' },
  { id: 'newest_active', label: 'Newest active' },
  { id: 'alphabetical', label: 'Alphabetical' },
];

const compareCirclePeople = (
  a: CirclePersonSummary,
  b: CirclePersonSummary,
  displayMode: CircleDisplayMode
) => {
  if (displayMode === 'team') {
    return (
      String(a.teams[0]?.name ?? '').localeCompare(String(b.teams[0]?.name ?? '')) ||
      String(a.name).localeCompare(String(b.name))
    );
  }
  if (displayMode === 'role') {
    return (
      String(a.role).localeCompare(String(b.role)) || String(a.name).localeCompare(String(b.name))
    );
  }
  if (displayMode === 'open_work') {
    return b.open_task_count - a.open_task_count || String(a.name).localeCompare(String(b.name));
  }
  if (displayMode === 'recent_activity' || displayMode === 'newest_active') {
    return (
      String(b.last_active_at ?? '').localeCompare(String(a.last_active_at ?? '')) ||
      String(a.name).localeCompare(String(b.name))
    );
  }
  return String(a.name).localeCompare(String(b.name));
};

const getInitials = (name: string, email?: string | null) => {
  const source = String(name ?? '').trim() || String(email ?? '').split('@')[0] || 'Member';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const formatShortDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatActivityDate = (value?: string | null) => {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatRelativeActive = (value?: string | null) => {
  if (!value) return 'No recent activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No recent activity';
  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
};

const parseCircleTimestamp = (value?: string | null) => {
  const parsed = Date.parse(value ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatTaskPriority = (value?: string | null) => {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'urgent') return 'Urgent';
  if (normalized === 'high') return 'High';
  if (normalized === 'low') return 'Low';
  return 'Medium';
};

const titleCase = (value?: string | null) =>
  String(value ?? '')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Member';

const formatActivityLabel = (value?: string | null) => {
  const normalized = String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';

  return normalized
    .split(' ')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
};

const CircleAvatar = ({ person }: { person: CirclePersonSummary }) => {
  const initials = getInitials(person.name, person.email);
  if (person.avatar_url) {
    return (
      <img
        src={person.avatar_url}
        alt={person.name}
        className="h-7 w-7 shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] object-cover"
      />
    );
  }
  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[10px] font-semibold text-[var(--ledger-text-secondary)]">
      {initials}
    </span>
  );
};

const SummaryCell = ({
  label,
  value,
  active = false,
  onClick,
}: {
  label: string;
  value: string | number;
  active?: boolean;
  onClick?: () => void;
}) => {
  const classes = `flex min-h-[42px] min-w-0 items-center justify-between gap-3 px-3 py-2.5 text-left transition ${
    active ? 'bg-[var(--ledger-surface-hover)]' : 'hover:bg-[var(--ledger-surface-muted)]'
  }`;

  const content = (
    <>
      <span className="min-w-0 truncate text-[11px] font-medium leading-4 text-[var(--ledger-text-muted)]">
        {label}
      </span>
      <span
        className={`shrink-0 text-[12px] font-medium leading-4 ${
          active ? 'text-[var(--ledger-text-primary)]' : 'text-[var(--ledger-text-secondary)]'
        }`}
      >
        {value}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
};

const SummaryStrip = ({
  items,
}: {
  items: Array<{
    label: string;
    value: string | number;
    active?: boolean;
    onClick?: () => void;
  }>;
}) => (
  <div className="overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)]">
    <div className="grid grid-cols-2 divide-x divide-[color:var(--ledger-border-subtle)] md:grid-cols-4">
      {items.map((item) => (
        <SummaryCell
          key={item.label}
          label={item.label}
          value={item.value}
          active={item.active}
          onClick={item.onClick}
        />
      ))}
    </div>
  </div>
);

const WorkspaceSection = ({
  title,
  action,
  children,
  collapsed,
  count,
  onToggle,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  collapsed: boolean;
  count?: number;
  onToggle: () => void;
}) => (
  <section className="space-y-2">
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onToggle();
      }}
      className="flex h-8 cursor-pointer select-none items-center justify-between rounded-lg bg-[var(--ledger-surface-muted)] px-3"
    >
      <div className="flex min-w-0 items-center gap-2 text-left select-none">
        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--ledger-text-muted)] transition ${
            collapsed ? '-rotate-90' : 'rotate-0'
          }`}
        />
        <span className="truncate text-[12px] font-medium text-[var(--ledger-text-secondary)]">
          {title}
        </span>
        {typeof count === 'number' && (
          <span className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--ledger-text-muted)]">
            {count}
          </span>
        )}
      </div>
      <div
        className="flex items-center gap-2"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {action}
      </div>
    </div>
    {!collapsed && <div className="space-y-1">{children}</div>}
  </section>
);

const CompactWorkRow = ({
  title,
  meta,
  right,
  onClick,
  selected = false,
  icon,
  compact = false,
}: {
  title: string;
  meta?: string | ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  icon?: ReactNode;
  compact?: boolean;
}) => {
  const classes = `${circleTheme.sectionRow} rounded-lg border border-transparent bg-transparent ${
    selected
      ? 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)]'
      : 'hover:bg-[var(--ledger-surface-muted)]'
  } ${onClick ? 'cursor-pointer' : ''} ${compact ? 'min-h-[38px]' : 'min-h-[42px]'}`;
  const content = (
    <>
      <div className="flex h-5 w-5 shrink-0 items-center justify-center self-center text-[var(--ledger-text-muted)]">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-[13px] font-medium leading-5 text-[var(--ledger-text-primary)]">
            {title}
          </p>
          {meta &&
            (typeof meta === 'string' ? (
              <p className="hidden min-w-0 truncate text-[11px] leading-4 text-[var(--ledger-text-muted)] sm:block">
                {meta}
              </p>
            ) : (
              <div className="hidden min-w-0 sm:block">{meta}</div>
            ))}
        </div>
      </div>
      {right && (
        <div className="flex shrink-0 items-center justify-end gap-2 text-right">{right}</div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
};

const Row = ({
  title,
  meta,
  right,
  onClick,
  selected = false,
  icon,
}: {
  title: string;
  meta?: string | ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  icon?: ReactNode;
}) => {
  const className = `${circleTheme.row} ${selected ? circleTheme.rowSelected : ''}`;
  const content = (
    <>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={circleTheme.rowTitle}>{title}</p>
        </div>
        {meta && typeof meta === 'string' ? <p className={circleTheme.rowMeta}>{meta}</p> : meta}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
};

const buildPersonContext = (person: CirclePersonSummary) =>
  `ledger-person|${person.id}|${encodeURIComponent(person.name)}`;

type CircleSelectedPersonCache = {
  updatedAt: number;
  person: CirclePersonSummary | null;
  work: CirclePersonDetailPayload | null;
  projects: CirclePersonProjectsPayload | null;
  followUps: CirclePersonFollowUpsPayload | null;
  activity: CirclePersonActivityPayload | null;
};

const CIRCLE_CACHE_MAX_AGE = 45_000;
const circlePeopleCache = new Map<string, { updatedAt: number; people: CirclePersonSummary[] }>();
const circleSelectedPersonCache = new Map<string, CircleSelectedPersonCache>();

export const CircleWindow = ({ focusContext }: { focusContext?: string | null } = {}) => {
  const api = useApi();
  const { workspaceShellLayout } = useSidebar();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();

  const [people, setPeople] = useState<CirclePersonSummary[]>(() =>
    activeWorkspaceId ? circlePeopleCache.get(activeWorkspaceId)?.people ?? [] : []
  );
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<CirclePersonSummary | null>(null);
  const [selectedWork, setSelectedWork] = useState<CirclePersonDetailPayload | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<CirclePersonProjectsPayload | null>(
    null
  );
  const [selectedFollowUps, setSelectedFollowUps] = useState<CirclePersonFollowUpsPayload | null>(
    null
  );
  const [selectedActivity, setSelectedActivity] = useState<CirclePersonActivityPayload | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<CircleDetailTab>('overview');
  const [listTab, setListTab] = useState<CircleListTab>('all');
  const [displayMode, setDisplayMode] = useState<CircleDisplayMode>('newest_active');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [collapsedCircleSections, setCollapsedCircleSections] = useState<
    Record<CircleWorkspaceSectionId, boolean>
  >({
    needs_attention: false,
    assigned_work: false,
    shared_projects: false,
    follow_ups: false,
    recent_activity: false,
    pinned_people: false,
  });
  const [filters, setFilters] = useState<CircleFilters>({
    teamId: null,
    role: null,
    hasOpenTasks: false,
    hasSharedProjects: false,
    waitingOn: false,
    pinned: false,
  });
  const [isLoadingPeople, setIsLoadingPeople] = useState(false);
  const [isLoadingSelected, setIsLoadingSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [moreMenuStyle, setMoreMenuStyle] = useState<CSSProperties | null>(null);
  const [composerMode, setComposerMode] = useState<CircleComposerMode | null>(null);
  const [circleTaskType, setCircleTaskType] = useState<CircleTaskType>('focus');
  const [composerTitle, setComposerTitle] = useState('');
  const [composerDueDate, setComposerDueDate] = useState('');
  const [isSavingComposer, setIsSavingComposer] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const peopleLoadTokenRef = useRef(0);
  const selectedLoadTokenRef = useRef(0);
  const previousFocusContextRef = useRef(focusContext ?? null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  const loadPeople = async (query?: string) => {
    if (!activeWorkspaceId) {
      setPeople([]);
      setSelectedPersonId(null);
      setSelectedPerson(null);
      setSelectedWork(null);
      setSelectedProjects(null);
      setSelectedFollowUps(null);
      setSelectedActivity(null);
      return;
    }

    const token = ++peopleLoadTokenRef.current;
    const cached = !query?.trim() ? circlePeopleCache.get(activeWorkspaceId) : undefined;
    if (cached) setPeople(cached.people);
    if (!cached) setIsLoadingPeople(true);
    setError(null);

    if (cached && Date.now() - cached.updatedAt < CIRCLE_CACHE_MAX_AGE) {
      setIsLoadingPeople(false);
      return;
    }

    try {
      const payload = (await api.getPeople(query)) as { people?: CirclePersonSummary[] };
      if (peopleLoadTokenRef.current !== token) return;

      const nextPeople = Array.isArray(payload?.people) ? payload.people : [];
      if (!query?.trim()) {
        circlePeopleCache.set(activeWorkspaceId, { updatedAt: Date.now(), people: nextPeople });
      }
      setPeople(nextPeople);

      if (selectedPersonId && !nextPeople.some((person) => person.id === selectedPersonId)) {
        setSelectedPersonId(null);
        setSelectedPerson(null);
        setSelectedWork(null);
        setSelectedProjects(null);
        setSelectedFollowUps(null);
        setSelectedActivity(null);
      }
    } catch (fetchError) {
      if (peopleLoadTokenRef.current !== token) return;
      setPeople([]);
      setSelectedPersonId(null);
      setSelectedPerson(null);
      setSelectedWork(null);
      setSelectedProjects(null);
      setSelectedFollowUps(null);
      setSelectedActivity(null);
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load people.');
    } finally {
      if (peopleLoadTokenRef.current === token) {
        setIsLoadingPeople(false);
      }
    }
  };

  const loadSelectedPerson = async (personId: string) => {
    if (!activeWorkspaceId) return;
    const cacheKey = `${activeWorkspaceId}|${personId}`;
    const cached = circleSelectedPersonCache.get(cacheKey);
    if (cached) {
      setSelectedPerson(cached.person);
      setSelectedWork(cached.work);
      setSelectedProjects(cached.projects);
      setSelectedFollowUps(cached.followUps);
      setSelectedActivity(cached.activity);
    }
    const token = ++selectedLoadTokenRef.current;
    if (!cached) setIsLoadingSelected(true);
    setError(null);

    if (cached && Date.now() - cached.updatedAt < CIRCLE_CACHE_MAX_AGE) {
      setIsLoadingSelected(false);
      return;
    }

    try {
      const [personPayload, workPayload, projectsPayload, followUpsPayload, activityPayload] =
        await Promise.all([
          api.getPerson(personId),
          api.getPersonWork(personId),
          api.getPersonProjects(personId),
          api.getPersonFollowUps(personId),
          api.getPersonActivity(personId),
        ]);

      if (selectedLoadTokenRef.current !== token) return;

      const nextSelectedPerson =
        (personPayload as { person?: CirclePersonSummary })?.person ?? null;
      const nextSelectedWork = workPayload as CirclePersonDetailPayload;
      const nextSelectedProjects = projectsPayload as CirclePersonProjectsPayload;
      const nextSelectedFollowUps = followUpsPayload as CirclePersonFollowUpsPayload;
      const nextSelectedActivity = activityPayload as CirclePersonActivityPayload;
      circleSelectedPersonCache.set(cacheKey, {
        updatedAt: Date.now(),
        person: nextSelectedPerson,
        work: nextSelectedWork,
        projects: nextSelectedProjects,
        followUps: nextSelectedFollowUps,
        activity: nextSelectedActivity,
      });
      setSelectedPerson(nextSelectedPerson);
      setSelectedWork(nextSelectedWork);
      setSelectedProjects(nextSelectedProjects);
      setSelectedFollowUps(nextSelectedFollowUps);
      setSelectedActivity(nextSelectedActivity);
    } catch (fetchError) {
      if (selectedLoadTokenRef.current !== token) return;
      setSelectedPerson(null);
      setSelectedWork(null);
      setSelectedProjects(null);
      setSelectedFollowUps(null);
      setSelectedActivity(null);
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load person details.');
    } finally {
      if (selectedLoadTokenRef.current === token) {
        setIsLoadingSelected(false);
      }
    }
  };

  useEffect(() => {
    setPeople(activeWorkspaceId ? circlePeopleCache.get(activeWorkspaceId)?.people ?? [] : []);
    setSelectedPersonId(null);
    setSelectedPerson(null);
    setSelectedWork(null);
    setSelectedProjects(null);
    setSelectedFollowUps(null);
    setSelectedActivity(null);
    setActiveTab('overview');
    setSearchQuery('');
    setCollapsedCircleSections({
      needs_attention: false,
      assigned_work: false,
      shared_projects: false,
      follow_ups: false,
      recent_activity: false,
      pinned_people: false,
    });
    setFilters({
      teamId: null,
      role: null,
      hasOpenTasks: false,
      hasSharedProjects: false,
      waitingOn: false,
      pinned: false,
    });
    setListTab('all');
  }, [activeWorkspaceId]);

  useEffect(() => {
    const raw = String(focusContext ?? '').trim();
    if (!raw.startsWith('ledger-person|')) return;
    const [, personId = '', , tab = ''] = raw.split('|');
    if (!personId) return;
    setSelectedPersonId(personId);
    setActiveTab(tab === 'projects' ? 'projects' : 'overview');
  }, [focusContext]);

  const routePerson = people.find((person) => person.id === selectedPersonId) ?? selectedPerson;
  useWorkspaceRouteHistory(
    {
      kind: 'circle',
      focusContext: routePerson ? buildPersonContext(routePerson) : null,
    },
    Boolean(activeWorkspaceId)
  );

  useEffect(() => {
    const previousFocusContext = previousFocusContextRef.current;
    previousFocusContextRef.current = focusContext ?? null;
    if (previousFocusContext === (focusContext ?? null)) return;
    if (!activeWorkspaceId || people.length > 0) return;

    void loadPeople(debouncedSearchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusContext]);

  useEffect(() => {
    const handleWorkspaceRouteChanged = (_event: unknown, route?: { kind?: string | null }) => {
      if (route?.kind !== 'circle' || !activeWorkspaceId || people.length > 0) return;
      void loadPeople(debouncedSearchQuery);
    };

    window.ipcRenderer?.on?.('workspace:route-changed', handleWorkspaceRouteChanged as any);
    return () => {
      window.ipcRenderer?.off?.('workspace:route-changed', handleWorkspaceRouteChanged as any);
    };
    // Circle stays mounted while other tabs are active, so reload an empty
    // people list whenever the shared workspace route returns to Circle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, debouncedSearchQuery, people.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 180);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    void loadPeople(debouncedSearchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, api, debouncedSearchQuery]);

  useEffect(() => {
    if (!selectedPersonId) return;
    void loadSelectedPerson(selectedPersonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersonId, activeWorkspaceId, api]);

  useWorkspaceRealtimeRefresh({
    workspaceId: activeWorkspaceId,
    tables: [
      'tasks',
      'projects',
      'workspace_audit_logs',
      'workspace_team_members',
      'workspace_members',
      'person_preferences',
    ],
    enabled: Boolean(activeWorkspaceId),
    onChange: () => {
      void loadPeople(debouncedSearchQuery);
      if (selectedPersonId) {
        void loadSelectedPerson(selectedPersonId);
      }
    },
  });

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (showFilterMenu && filterMenuRef.current && !filterMenuRef.current.contains(target)) {
        setShowFilterMenu(false);
      }
      if (showDisplayMenu && displayMenuRef.current && !displayMenuRef.current.contains(target)) {
        setShowDisplayMenu(false);
      }
      if (showMoreMenu && moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setShowMoreMenu(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowFilterMenu(false);
      setShowDisplayMenu(false);
      setShowMoreMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showDisplayMenu, showFilterMenu, showMoreMenu]);

  useEffect(() => {
    if (!showMoreMenu) return;
    const viewportPadding = 12;
    const menuWidth = 240;
    const buttonRect = moreMenuButtonRef.current?.getBoundingClientRect();
    if (!buttonRect) return;

    const left = Math.max(
      viewportPadding,
      Math.min(buttonRect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding)
    );
    const top = Math.min(buttonRect.bottom + 8, window.innerHeight - viewportPadding - 180);

    setMoreMenuStyle({
      position: 'fixed',
      left,
      top,
      width: menuWidth,
    });
  }, [showMoreMenu]);

  const currentWorkspaceName = activeWorkspace?.name ?? 'Workspace';
  const selectedPersonDetails =
    selectedPerson ?? people.find((person) => person.id === selectedPersonId) ?? null;
  const selectedPersonTasks = selectedWork?.assigned_tasks ?? [];
  const selectedProjectsRows = selectedProjects?.shared_projects ?? [];
  const selectedFollowUpItems = selectedFollowUps?.items ?? [];
  const selectedActivityRows = selectedActivity?.activity ?? [];

  const selectedPersonPrimaryTeam = selectedPersonDetails?.teams?.[0]?.name ?? null;
  const selectedPersonDisplayRole = titleCase(selectedPersonDetails?.role ?? 'member');

  const openCircleComposer = (mode: CircleComposerMode) => {
    if (!selectedPersonDetails) return;
    setComposerMode(mode);
    setCircleTaskType(mode === 'follow-up' ? 'long_term' : 'focus');
    setComposerTitle('');
    setComposerDueDate('');
    setComposerError(null);
  };

  const closeCircleComposer = () => {
    if (isSavingComposer) return;
    setComposerMode(null);
    setComposerError(null);
  };

  const saveCircleComposer = async () => {
    if (!selectedPersonDetails || !composerTitle.trim() || !activeWorkspaceId) return;

    setIsSavingComposer(true);
    setComposerError(null);
    try {
      const isFollowUp = composerMode === 'follow-up';
      const taskType = isFollowUp ? 'long_term' : circleTaskType;
      await api.createTask({
        title: composerTitle.trim(),
        description: isFollowUp
          ? `Follow-up for ${selectedPersonDetails.name}`
          : `Assigned from Circle: ${selectedPersonDetails.name}`,
        notes: isFollowUp ? `Created for ${selectedPersonDetails.name}` : null,
        due_date:
          composerDueDate ||
          (isFollowUp
            ? new Date().toISOString().slice(0, 10)
            : taskType === 'long_term'
            ? null
            : null),
        due_time: null,
        status: 'todo',
        priority: 'medium',
        assigned_to_user_id: selectedPersonDetails.id,
        task_horizon: taskType === 'long_term' ? 'long_term' : 'today',
        show_in_today: taskType !== 'long_term',
        is_today_focus: taskType === 'focus',
      });
      setComposerMode(null);
      setComposerTitle('');
      setComposerDueDate('');
      if (selectedPersonId) {
        void loadSelectedPerson(selectedPersonId);
      }
      void loadPeople(debouncedSearchQuery);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'Could not create this item.');
    } finally {
      setIsSavingComposer(false);
    }
  };
  const circleOverviewRows = useMemo(() => {
    const now = Date.now();
    const weekThreshold = now - 1000 * 60 * 60 * 24 * 7;

    const overviewPeople = people.filter((person) => {
      if (filters.teamId && !person.teams.some((team) => team.id === filters.teamId)) return false;
      if (filters.role && String(person.role ?? '').toLowerCase() !== filters.role) return false;
      if (filters.hasOpenTasks && person.open_task_count <= 0) return false;
      if (filters.hasSharedProjects && person.shared_project_count <= 0) return false;
      if (filters.waitingOn && person.waiting_on_count <= 0) return false;
      if (filters.pinned && !person.is_pinned) return false;
      return true;
    });

    const sortForDisplay = (rows: CirclePersonSummary[]) =>
      [...rows].sort((a, b) => compareCirclePeople(a, b, displayMode));

    const peopleCount = overviewPeople.length;
    const activeThisWeek = overviewPeople.filter(
      (person) => parseCircleTimestamp(person.last_active_at) >= weekThreshold
    ).length;
    const waitingOnPeople = overviewPeople.filter((person) => person.waiting_on_count > 0).length;
    const openFollowUps = overviewPeople.reduce(
      (total, person) => total + Math.max(0, person.follow_up_count),
      0
    );

    const needsAttention = sortForDisplay(overviewPeople)
      .filter((person) => person.waiting_on_count > 0 || person.open_task_count > 0)
      .slice(0, 5);

    const recentlyActive = sortForDisplay(overviewPeople)
      .filter((person) => parseCircleTimestamp(person.last_active_at) >= weekThreshold)
      .slice(0, 5);

    const sharedWork = sortForDisplay(overviewPeople)
      .filter((person) => person.shared_project_count > 0 || person.open_task_count > 0)
      .slice(0, 5);

    const pinnedPeople = sortForDisplay(overviewPeople)
      .filter((person) => person.is_pinned)
      .slice(0, 5);

    return {
      summary: [
        { label: 'People', value: peopleCount },
        { label: 'Active this week', value: activeThisWeek },
        { label: 'Waiting on', value: waitingOnPeople },
        { label: 'Open follow-ups', value: openFollowUps },
      ],
      needsAttention,
      recentlyActive,
      sharedWork,
      pinnedPeople,
    };
  }, [displayMode, filters, people]);

  const visiblePeople = useMemo(() => {
    const todayThreshold = Date.now() - 1000 * 60 * 60 * 24 * 14;

    const matchesFilters = (person: CirclePersonSummary) => {
      if (filters.teamId && !person.teams.some((team) => team.id === filters.teamId)) return false;
      if (filters.role && String(person.role ?? '').toLowerCase() !== filters.role) return false;
      if (filters.hasOpenTasks && person.open_task_count <= 0) return false;
      if (filters.hasSharedProjects && person.shared_project_count <= 0) return false;
      if (filters.waitingOn && person.waiting_on_count <= 0) return false;
      if (filters.pinned && !person.is_pinned) return false;

      switch (listTab) {
        case 'active':
          return (
            person.open_task_count > 0 || Date.parse(person.last_active_at ?? '') >= todayThreshold
          );
        case 'waiting_on':
          return person.waiting_on_count > 0;
        case 'shared_work':
          return person.shared_project_count > 0;
        case 'pinned':
          return person.is_pinned;
        case 'all':
        default:
          return true;
      }
    };

    return [...people]
      .filter(matchesFilters)
      .sort((a, b) => compareCirclePeople(a, b, displayMode));
  }, [displayMode, filters, listTab, people]);

  const sharedProjectFromWork = selectedProjectsRows[0] ?? null;

  const openSharedProject = (projectId: string) => {
    void window.desktopWindow?.toggleModule('projects', {
      kind: 'projects',
      focusProjectId: projectId,
    } as any);
  };

  const openTask = (taskId: string) => {
    void window.desktopWindow?.toggleModule('projects', {
      kind: 'projects',
      focusTaskId: taskId,
    } as any);
  };

  const openActivity = () => setActiveTab('activity');

  const copyPersonEmail = async (person: CirclePersonSummary) => {
    if (!person.email) return;
    try {
      await navigator.clipboard.writeText(person.email);
    } catch {
      setError('Could not copy email.');
    }
  };

  const openPersonWorkspace = (personId: string) => {
    setSelectedPersonId(personId);
    setShowFilterMenu(false);
    setShowDisplayMenu(false);
    setShowMoreMenu(false);
  };

  const clearPersonWorkspace = () => {
    selectedLoadTokenRef.current += 1;
    setSelectedPersonId(null);
    setSelectedPerson(null);
    setSelectedWork(null);
    setSelectedProjects(null);
    setSelectedFollowUps(null);
    setSelectedActivity(null);
    setIsLoadingSelected(false);
    setActiveTab('overview');
    setComposerMode(null);
    setError(null);
  };

  const renderCircleOverviewHeader = () => (
    <section className={circleTheme.panel}>
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--ledger-text-muted)]">
              People connected to your work, follow-ups, and shared context.
            </p>
            <p className="mt-1 text-[11px] text-[var(--ledger-text-muted)]">
              {currentWorkspaceName}
            </p>
          </div>
        </div>
      </div>
      <div className="border-t border-[color:var(--ledger-border-subtle)] px-4 py-3">
        <SummaryStrip
          items={circleOverviewRows.summary.map((item) => ({
            label: item.label,
            value: item.value,
          }))}
        />
      </div>
    </section>
  );

  const renderOverviewPersonRow = (
    person: CirclePersonSummary,
    meta: string,
    right: ReactNode,
    onClickPerson?: () => void
  ) => (
    <CompactWorkRow
      key={person.id}
      title={person.name}
      meta={meta}
      right={right}
      icon={<CircleAvatar person={person} />}
      onClick={onClickPerson ?? (() => openPersonWorkspace(person.id))}
    />
  );

  const renderCircleOverview = () => {
    const needsAttention = circleOverviewRows.needsAttention;
    const recentlyActive = circleOverviewRows.recentlyActive;
    const sharedWork = circleOverviewRows.sharedWork;
    const pinnedPeople = circleOverviewRows.pinnedPeople;
    const isCollapsed = (sectionId: CircleWorkspaceSectionId) => collapsedCircleSections[sectionId];
    const toggleSection = (sectionId: CircleWorkspaceSectionId, count: number) => {
      if (count === 0) return;
      setCollapsedCircleSections((current) => ({
        ...current,
        [sectionId]: !current[sectionId],
      }));
    };

    return (
      <div className="space-y-4">
        {renderCircleOverviewHeader()}

        {isLoadingPeople ? (
          <section className={circleTheme.panel}>
            <div className="space-y-1 p-3">
              <div className="h-8 rounded-lg bg-[var(--ledger-surface-muted)]/70" />
              <div className="h-8 rounded-lg bg-[var(--ledger-surface-muted)]/70" />
              <div className="h-8 rounded-lg bg-[var(--ledger-surface-muted)]/70" />
            </div>
          </section>
        ) : (
          <div className="space-y-4">
            <WorkspaceSection
              title="Needs attention"
              collapsed={needsAttention.length === 0 || isCollapsed('needs_attention')}
              onToggle={() => toggleSection('needs_attention', needsAttention.length)}
              count={needsAttention.length}
              action={
                <button
                  type="button"
                  onClick={() => setListTab('waiting_on')}
                  className={circleTheme.sectionActionText}
                >
                  View all
                </button>
              }
            >
              {needsAttention.length > 0 ? (
                needsAttention.map((person) =>
                  renderOverviewPersonRow(
                    person,
                    person.waiting_on_count > 0
                      ? `Waiting on ${person.waiting_on_count}${
                          person.open_task_count > 0 ? ` · ${person.open_task_count} open` : ''
                        }`
                      : `${person.open_task_count} open`,
                    <div className="flex items-center gap-2 text-[11px] leading-4 text-[var(--ledger-text-secondary)]">
                      <span>{person.teams[0]?.name ?? 'No team'}</span>
                      <span className="text-[var(--ledger-text-muted)]">·</span>
                      <span>{formatRelativeActive(person.last_active_at)}</span>
                    </div>
                  )
                )
              ) : (
                <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">
                  No people-related items need attention.
                </p>
              )}
            </WorkspaceSection>

            <WorkspaceSection
              title="Recently active"
              collapsed={recentlyActive.length === 0 || isCollapsed('recent_activity')}
              onToggle={() => toggleSection('recent_activity', recentlyActive.length)}
              count={recentlyActive.length}
              action={
                <button
                  type="button"
                  onClick={() => setListTab('active')}
                  className={circleTheme.sectionActionText}
                >
                  View all
                </button>
              }
            >
              {recentlyActive.length > 0 ? (
                recentlyActive.map((person) =>
                  renderOverviewPersonRow(
                    person,
                    person.role,
                    <p className="text-[11px] leading-4 text-[var(--ledger-text-secondary)]">
                      {formatRelativeActive(person.last_active_at)}
                    </p>
                  )
                )
              ) : (
                <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">
                  No recent activity.
                </p>
              )}
            </WorkspaceSection>

            <WorkspaceSection
              title="Shared work"
              collapsed={sharedWork.length === 0 || isCollapsed('shared_projects')}
              onToggle={() => toggleSection('shared_projects', sharedWork.length)}
              count={sharedWork.length}
              action={
                <button
                  type="button"
                  onClick={() => setListTab('shared_work')}
                  className={circleTheme.sectionActionText}
                >
                  View all
                </button>
              }
            >
              {sharedWork.length > 0 ? (
                sharedWork.map((person) =>
                  renderOverviewPersonRow(
                    person,
                    person.teams[0]?.name ?? 'No team',
                    <div className="flex items-center gap-2 text-[11px] leading-4 text-[var(--ledger-text-secondary)]">
                      <span>{person.shared_project_count} shared</span>
                      <span className="text-[var(--ledger-text-muted)]">·</span>
                      <span>{person.open_task_count} open</span>
                    </div>
                  )
                )
              ) : (
                <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">
                  No shared work yet.
                </p>
              )}
            </WorkspaceSection>

            <WorkspaceSection
              title="Pinned people"
              collapsed={pinnedPeople.length === 0 || isCollapsed('pinned_people')}
              onToggle={() => toggleSection('pinned_people', pinnedPeople.length)}
              count={pinnedPeople.length}
              action={
                <button
                  type="button"
                  onClick={() => setListTab('pinned')}
                  className={circleTheme.sectionActionText}
                >
                  View all
                </button>
              }
            >
              {pinnedPeople.length > 0 ? (
                pinnedPeople.map((person) =>
                  renderOverviewPersonRow(
                    person,
                    person.role,
                    <div className="flex items-center gap-2 text-[11px] leading-4 text-[var(--ledger-text-secondary)]">
                      <span>{person.waiting_on_count} waiting</span>
                      <span className="text-[var(--ledger-text-muted)]">·</span>
                      <span>{person.open_task_count} open</span>
                    </div>
                  )
                )
              ) : (
                <div className="px-3 py-3">
                  <p className="text-sm text-[var(--ledger-text-muted)]">No pinned people yet.</p>
                  <button
                    type="button"
                    onClick={() => setListTab('all')}
                    className="mt-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                  >
                    Browse people
                  </button>
                </div>
              )}
            </WorkspaceSection>
          </div>
        )}
      </div>
    );
  };

  const renderPersonHeader = () => {
    if (!selectedPersonDetails) return null;

    return (
      <section className={circleTheme.panel}>
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <CircleAvatar person={selectedPersonDetails} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[20px] font-medium text-[var(--ledger-text-primary)]">
                  {selectedPersonDetails.name}
                </h2>
              </div>
              <p className={circleTheme.headerMeta}>
                {selectedPersonDisplayRole}
                {selectedPersonPrimaryTeam ? ` · ${selectedPersonPrimaryTeam}` : ''}
                {selectedPersonDetails.email ? ` · ${selectedPersonDetails.email}` : ''}
              </p>
              <p className="mt-1 text-[11px] text-[var(--ledger-text-muted)]">
                {selectedPersonDetails.teams.length > 0
                  ? selectedPersonDetails.teams.map((team) => team.name).join(' · ')
                  : 'No team membership'}
                {' · '}
                {currentWorkspaceName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <PinActionButton
              objectType="person"
              objectId={selectedPersonDetails.id}
              className={circleTheme.primaryButton}
            />
            <button
              ref={moreMenuButtonRef}
              type="button"
              onClick={() => setShowMoreMenu((current) => !current)}
              className={circleTheme.mutedButton}
            >
              <MoreHorizontal size={11} />
              More
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[color:var(--ledger-border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={() => openCircleComposer('task')}
            className={circleTheme.subtleButton}
          >
            <Plus size={11} />
            Assign task
          </button>
          <button
            type="button"
            onClick={() => openCircleComposer('follow-up')}
            className={circleTheme.subtleButton}
          >
            <ArrowRight size={11} />
            Create follow-up
          </button>
          <button
            type="button"
            onClick={() => {
              if (sharedProjectFromWork) openSharedProject(sharedProjectFromWork.id);
            }}
            disabled={!sharedProjectFromWork}
            className={`${circleTheme.subtleButton} ${
              !sharedProjectFromWork ? 'cursor-not-allowed opacity-40' : ''
            }`}
          >
            <Folder size={11} />
            Open shared project
          </button>
        </div>

        <div className="border-t border-[color:var(--ledger-border-subtle)] px-4 py-3">
          <SummaryStrip
            items={[
              {
                label: 'Open tasks',
                value:
                  selectedWork?.summary.open_task_count ?? selectedPersonDetails.open_task_count,
                active: activeTab === 'assigned',
                onClick: () => setActiveTab('assigned'),
              },
              {
                label: 'Shared projects',
                value:
                  selectedWork?.summary.shared_project_count ??
                  selectedPersonDetails.shared_project_count,
                active: activeTab === 'projects',
                onClick: () => setActiveTab('projects'),
              },
              {
                label: 'Follow-ups',
                value:
                  selectedWork?.summary.follow_up_count ?? selectedPersonDetails.follow_up_count,
                active: activeTab === 'followups',
                onClick: () => setActiveTab('followups'),
              },
              {
                label: 'Waiting on',
                value:
                  selectedWork?.summary.waiting_on_count ?? selectedPersonDetails.waiting_on_count,
                active: activeTab === 'overview',
                onClick: () => setActiveTab('overview'),
              },
            ]}
          />
        </div>
      </section>
    );
  };

  const renderTaskRow = (task: CirclePersonTask) => (
    <CompactWorkRow
      key={task.id}
      title={task.title}
      meta={[
        task.status_label,
        task.project_name,
        task.due_date ? `Due ${formatShortDate(task.due_date)}` : null,
        task.is_overdue ? 'Overdue' : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      right={
        <div className="flex items-center gap-2 text-[11px] leading-4 text-[var(--ledger-text-secondary)]">
          <span className="font-medium">{formatTaskPriority(task.priority)}</span>
          <span className="text-[var(--ledger-text-muted)]">·</span>
          <span>{task.project_status ?? 'Task'}</span>
        </div>
      }
      icon={
        <CheckCircle2
          size={13}
          className={
            task.is_open ? 'text-[var(--ledger-text-muted)]' : 'text-[var(--ledger-accent)]'
          }
        />
      }
      onClick={() => openTask(task.id)}
    />
  );

  const renderProjectRow = (project: CirclePersonProject) => (
    <CompactWorkRow
      key={project.id}
      title={project.title}
      meta={[
        project.status,
        project.due_date ? `Due ${formatShortDate(project.due_date)}` : null,
        project.next_action_count ? `${project.next_action_count} next` : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      right={
        <div className="flex items-center gap-2 text-[11px] leading-4 text-[var(--ledger-text-secondary)]">
          <span className="font-medium">{project.role}</span>
          <span className="text-[var(--ledger-text-muted)]">·</span>
          <span>{Math.round(project.progress)}%</span>
          <div className="hidden h-1.5 w-14 rounded-full bg-[var(--ledger-surface-muted)] sm:block">
            <div
              className="h-1.5 rounded-full"
              style={{
                width: `${Math.max(4, Math.min(100, project.progress))}%`,
                backgroundColor: project.color,
              }}
            />
          </div>
        </div>
      }
      icon={<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} />}
      onClick={() => openSharedProject(project.id)}
    />
  );

  const renderActivityRow = (activity: CirclePersonActivity) => (
    <CompactWorkRow
      key={activity.id}
      title={formatActivityLabel(activity.title)}
      meta={[
        formatActivityLabel(activity.detail),
        activity.timestamp ? formatActivityDate(activity.timestamp) : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      right={
        <p className="text-[11px] leading-4 text-[var(--ledger-text-secondary)]">
          {formatRelativeActive(activity.timestamp)}
        </p>
      }
      icon={<Clock3 size={13} className="text-[var(--ledger-text-muted)]" />}
      onClick={
        activity.project_id
          ? () => openSharedProject(activity.project_id as string)
          : activity.task_id
          ? () => openTask(activity.task_id as string)
          : undefined
      }
    />
  );

  const renderOverview = () => {
    const needsAttention = selectedWork?.needs_attention ?? [];
    const sharedProjects = selectedProjectsRows.slice(0, 4);
    const tasks = selectedPersonTasks.slice(0, 4);
    const activity = selectedActivityRows.slice(0, 4);
    const isCollapsed = (sectionId: CircleWorkspaceSectionId) => collapsedCircleSections[sectionId];
    const toggleSection = (sectionId: CircleWorkspaceSectionId, count: number) => {
      if (count === 0) return;
      setCollapsedCircleSections((current) => ({
        ...current,
        [sectionId]: !current[sectionId],
      }));
    };

    return (
      <div className="space-y-4">
        <WorkspaceSection
          title="Needs attention"
          collapsed={needsAttention.length === 0 || isCollapsed('needs_attention')}
          onToggle={() => toggleSection('needs_attention', needsAttention.length)}
          count={needsAttention.length}
          action={
            <button
              type="button"
              onClick={() => setActiveTab('assigned')}
              className={circleTheme.sectionActionText}
            >
              View all
            </button>
          }
        >
          {needsAttention.length > 0 ? (
            needsAttention.map(renderTaskRow)
          ) : (
            <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">
              No urgent work right now.
            </p>
          )}
        </WorkspaceSection>

        <WorkspaceSection
          title="Assigned work"
          collapsed={tasks.length === 0 || isCollapsed('assigned_work')}
          onToggle={() => toggleSection('assigned_work', tasks.length)}
          count={tasks.length}
          action={
            <button
              type="button"
              onClick={() => setActiveTab('assigned')}
              className={circleTheme.sectionActionText}
            >
              View all
            </button>
          }
        >
          {tasks.length > 0 ? (
            tasks.map(renderTaskRow)
          ) : (
            <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">
              No open work assigned.
            </p>
          )}
        </WorkspaceSection>

        <WorkspaceSection
          title="Shared projects"
          collapsed={sharedProjects.length === 0 || isCollapsed('shared_projects')}
          onToggle={() => toggleSection('shared_projects', sharedProjects.length)}
          count={sharedProjects.length}
          action={
            <button
              type="button"
              onClick={() => setActiveTab('projects')}
              className={circleTheme.sectionActionText}
            >
              View all
            </button>
          }
        >
          {sharedProjects.length > 0 ? (
            sharedProjects.map(renderProjectRow)
          ) : (
            <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">
              No shared projects yet.
            </p>
          )}
        </WorkspaceSection>

        <WorkspaceSection
          title="Follow-ups"
          collapsed={selectedFollowUpItems.length === 0 || isCollapsed('follow_ups')}
          onToggle={() => toggleSection('follow_ups', selectedFollowUpItems.length)}
          count={selectedFollowUpItems.length}
          action={
            <button
              type="button"
              onClick={() => setActiveTab('followups')}
              className={circleTheme.sectionActionText}
            >
              View all
            </button>
          }
        >
          <div className="px-3 py-3">
            {selectedFollowUpItems.length > 0 ? (
              <p className="text-sm text-[var(--ledger-text-muted)]">
                Follow-up records will appear here once that system is available.
              </p>
            ) : (
              <p className="text-sm text-[var(--ledger-text-muted)]">
                No follow-ups with this person yet.
              </p>
            )}
          </div>
        </WorkspaceSection>

        <WorkspaceSection
          title="Recent activity"
          collapsed={activity.length === 0 || isCollapsed('recent_activity')}
          onToggle={() => toggleSection('recent_activity', activity.length)}
          count={activity.length}
          action={
            <button
              type="button"
              onClick={() => setActiveTab('activity')}
              className={circleTheme.sectionActionText}
            >
              View all
            </button>
          }
        >
          {activity.length > 0 ? (
            activity.map(renderActivityRow)
          ) : (
            <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">No recent activity.</p>
          )}
        </WorkspaceSection>
      </div>
    );
  };

  const renderAssignedWork = () => (
    <div className="space-y-1">
      {selectedPersonTasks.length > 0 ? (
        selectedPersonTasks.map(renderTaskRow)
      ) : (
        <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">No open work assigned.</p>
      )}
    </div>
  );

  const renderProjects = () => (
    <div className="space-y-1">
      {selectedProjectsRows.length > 0 ? (
        selectedProjectsRows.map(renderProjectRow)
      ) : (
        <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">No shared projects yet.</p>
      )}
    </div>
  );

  const renderFollowUps = () => (
    <div className="space-y-3 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--ledger-text-muted)]">
          No follow-ups with this person yet.
        </p>
        <button
          type="button"
          onClick={() => openCircleComposer('follow-up')}
          className={circleTheme.subtleButton}
        >
          <Plus size={11} />
          Create follow-up
        </button>
      </div>
      {!selectedFollowUpItems.length && (
        <p className="text-xs text-[var(--ledger-text-muted)]">
          The dedicated follow-up system is still pending, so this tab stays empty for now.
        </p>
      )}
    </div>
  );

  const renderActivity = () => (
    <div className="space-y-1">
      {selectedActivityRows.length > 0 ? (
        selectedActivityRows.map(renderActivityRow)
      ) : (
        <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">No recent activity.</p>
      )}
    </div>
  );

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of people) {
      for (const team of person.teams) {
        if (!map.has(team.id)) {
          map.set(team.id, team.name);
        }
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [people]);

  const selectedRoleValue = filters.role ?? 'all';
  const selectedTeamValue = filters.teamId ?? 'all';
  const activeFilterCount =
    Number(Boolean(filters.teamId)) +
    Number(Boolean(filters.role)) +
    Number(filters.hasOpenTasks) +
    Number(filters.hasSharedProjects) +
    Number(filters.waitingOn) +
    Number(filters.pinned);

  const filterSelectClassName =
    'mt-1 h-8 w-full appearance-none rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 pr-8 text-[11px] text-[var(--ledger-text-primary)] outline-none';

  return (
    <div
      className={circleTheme.shell}
      style={{
        ...workspaceShellLayout.workspaceShellStyle,
        backgroundColor: 'var(--ledger-background)',
      }}
    >
      <ModuleWindowHeader
        title="Circle"
        subtitle="People, shared work, and what is waiting on whom."
        icon={<Users size={18} className="text-[#FF5F40]" />}
        compact
        showBodyHeader={false}
        stripTitle="Circle"
        onClose={() => window.desktopWindow?.closeModule('circle')}
        onMinimize={() => window.desktopWindow?.minimizeModule('circle')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('circle')}
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Inbox size={14} />}
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              title="Open Intake"
              ariaLabel="Open Intake"
            />
            <ModuleHeaderStripAction
              icon={<Bell size={14} />}
              notificationTrayToggle
              onClick={() =>
                window.dispatchEvent(new CustomEvent('ledger:toggle-notification-tray'))
              }
              title="Open notifications"
              ariaLabel="Open notifications"
            />
          </>
        }
        viewControls={
          <ModuleHeaderSegmentedGroup compact>
            {circleTabs.map((tab) => (
              <ModuleHeaderSegmentedButton
                key={tab.id}
                compact
                title={tab.label}
                onClick={() => setListTab(tab.id)}
                active={listTab === tab.id}
              >
                {tab.label}
              </ModuleHeaderSegmentedButton>
            ))}
          </ModuleHeaderSegmentedGroup>
        }
        primaryActions={
          <div className="flex items-center gap-2">
            <div className="relative" ref={filterMenuRef}>
              <ModuleHeaderActionButton
                variant="strip"
                iconOnly
                square
                title="Filter people"
                ariaLabel="Filter people"
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
                onClick={() => {
                  setShowFilterMenu((current) => !current);
                  setShowDisplayMenu(false);
                }}
              >
                Filter
              </ModuleHeaderActionButton>
              {showFilterMenu && (
                <div className="absolute right-0 top-9 z-50 w-72 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] font-medium text-[var(--ledger-text-secondary)]">
                        Team
                      </label>
                      <div className="relative">
                        <select
                          value={selectedTeamValue}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              teamId: event.target.value === 'all' ? null : event.target.value,
                            }))
                          }
                          className={filterSelectClassName}
                        >
                          <option value="all">All teams</option>
                          {teamOptions.map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ledger-text-secondary)]" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-[var(--ledger-text-secondary)]">
                        Role
                      </label>
                      <div className="relative">
                        <select
                          value={selectedRoleValue}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              role: event.target.value === 'all' ? null : event.target.value,
                            }))
                          }
                          className={filterSelectClassName}
                        >
                          <option value="all">All roles</option>
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ledger-text-secondary)]" />
                      </div>
                    </div>
                    {[
                      { key: 'hasOpenTasks', label: 'Has open tasks' },
                      { key: 'hasSharedProjects', label: 'Has shared projects' },
                      { key: 'waitingOn', label: 'Waiting on' },
                      { key: 'pinned', label: 'Pinned' },
                    ].map((item) => (
                      <label
                        key={item.key}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-[11px] text-[var(--ledger-text-secondary)]"
                      >
                        <span>{item.label}</span>
                        <input
                          type="checkbox"
                          checked={filters[item.key as keyof CircleFilters] as boolean}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              [item.key]: event.target.checked,
                            }))
                          }
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setFilters({
                          teamId: null,
                          role: null,
                          hasOpenTasks: false,
                          hasSharedProjects: false,
                          waitingOn: false,
                          pinned: false,
                        })
                      }
                      className={`${circleTheme.mutedButton} ml-auto`}
                    >
                      <X size={11} />
                      Reset filters
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="relative" ref={displayMenuRef}>
              <ModuleHeaderActionButton
                variant="strip"
                iconOnly
                square
                title="Display options"
                ariaLabel="Display options"
                icon={<LayoutList size={14} />}
                onClick={() => {
                  setShowDisplayMenu((current) => !current);
                  setShowFilterMenu(false);
                }}
              >
                Display
              </ModuleHeaderActionButton>
              {showDisplayMenu && (
                <div className="absolute right-0 top-full z-50 mt-2 w-[240px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[0_14px_34px_rgba(15,23,42,0.12)]">
                  <div className="max-h-[min(420px,calc(100vh-56px))] overflow-y-auto p-2">
                    <p className="px-3 pb-1 pt-2 text-[10px] font-medium text-[var(--ledger-text-muted)]">
                      Display
                    </p>
                    <div role="radiogroup" aria-label="Display" className="space-y-0.5">
                      {displayModes.map((option) => {
                        const selected = displayMode === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            onClick={() => setDisplayMode(option.id)}
                            className={`flex h-8 w-full items-center justify-between rounded-md px-3 text-left text-[12px] font-medium transition hover:bg-[var(--ledger-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ledger-accent)]/30 ${
                              selected
                                ? 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)]'
                                : 'text-[var(--ledger-text-secondary)]'
                            }`}
                          >
                            <span>{option.label}</span>
                            {selected && (
                              <Check size={14} className="text-[var(--ledger-text-primary)]" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        }
      />

      <div className={circleTheme.body}>
        <aside className={circleTheme.leftPane}>
          <div className={`${circleTheme.leftPaneHeader} flex items-center justify-between gap-2`}>
            {selectedPersonId ? (
              <button
                type="button"
                onClick={clearPersonWorkspace}
                className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <ArrowLeft size={12} />
                Overview
              </button>
            ) : (
              <span className="shrink-0">
                {isLoadingPeople ? 'Loading people…' : `${visiblePeople.length} people`}
              </span>
            )}
            <div className="flex h-7 w-[150px] max-w-[48%] shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2">
              <Search size={11} className="shrink-0 text-[var(--ledger-text-muted)]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search Circle"
                className="min-w-0 w-full bg-transparent text-[10px] text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)]"
              />
            </div>
          </div>
          <div className={circleTheme.leftList}>
            {visiblePeople.length > 0 ? (
              visiblePeople.map((person) => {
                const teamLabel = person.teams[0]?.name ?? 'No team';
                const secondary =
                  listTab === 'waiting_on'
                    ? `Waiting on ${person.waiting_on_count}`
                    : displayMode === 'role'
                    ? `${person.role} · ${teamLabel}`
                    : displayMode === 'team'
                    ? `${teamLabel} · ${person.role}`
                    : displayMode === 'open_work'
                    ? `${person.open_task_count} open`
                    : displayMode === 'recent_activity'
                    ? formatRelativeActive(person.last_active_at)
                    : `${teamLabel} · ${person.open_task_count} open`;

                return (
                  <Row
                    key={person.id}
                    selected={selectedPersonId === person.id}
                    onClick={() => {
                      if (selectedPersonId === person.id) {
                        clearPersonWorkspace();
                      } else {
                        openPersonWorkspace(person.id);
                      }
                    }}
                    icon={<CircleAvatar person={person} />}
                    title={person.name}
                    meta={
                      <div className="space-y-0">
                        <p className={circleTheme.rowMeta}>
                          {titleCase(person.role)}
                          {teamLabel ? ` · ${teamLabel}` : ''}
                        </p>
                        <p className={circleTheme.rowMetaStrong}>{secondary}</p>
                      </div>
                    }
                    right={
                      <div className="flex flex-col items-end gap-1">
                        {person.is_pinned && (
                          <Pin size={11} className="text-[var(--ledger-text-muted)]" />
                        )}
                        <p className={circleTheme.rowMeta}>
                          {formatRelativeActive(person.last_active_at)}
                        </p>
                      </div>
                    }
                  />
                );
              })
            ) : (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-[var(--ledger-text-muted)]">
                  {people.length === 0 ? 'No people in this workspace yet.' : 'No matches found.'}
                </p>
              </div>
            )}
          </div>
        </aside>

        <main className={circleTheme.content}>
          <div className={circleTheme.contentInner}>
            {error && (
              <div className="rounded-2xl border border-[color:rgba(255,95,64,0.18)] bg-[color:rgba(255,95,64,0.06)] px-4 py-3 text-sm text-[var(--ledger-accent)]">
                {error}
              </div>
            )}

            {selectedPersonDetails ? (
              <>
                {renderPersonHeader()}

                <section className={circleTheme.panel}>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
                    <h3 className={circleTheme.sectionTitle}>Person workspace</h3>
                    <ModuleHeaderSegmentedGroup compact>
                      {detailTabs.map((tab) => (
                        <ModuleHeaderSegmentedButton
                          key={tab.id}
                          compact
                          title={tab.label}
                          onClick={() => setActiveTab(tab.id)}
                          active={activeTab === tab.id}
                        >
                          {tab.label}
                        </ModuleHeaderSegmentedButton>
                      ))}
                    </ModuleHeaderSegmentedGroup>
                  </div>
                  <div className="px-4 py-4">
                    {isLoadingSelected ? (
                      <p className="text-sm text-[var(--ledger-text-muted)]">
                        Loading person details…
                      </p>
                    ) : activeTab === 'overview' ? (
                      <div className="space-y-4">{renderOverview()}</div>
                    ) : activeTab === 'assigned' ? (
                      renderAssignedWork()
                    ) : activeTab === 'projects' ? (
                      renderProjects()
                    ) : activeTab === 'followups' ? (
                      renderFollowUps()
                    ) : (
                      renderActivity()
                    )}
                  </div>
                </section>
              </>
            ) : (
              renderCircleOverview()
            )}
          </div>
        </main>
      </div>

      <ModalOverlay
        isOpen={Boolean(composerMode && selectedPersonDetails)}
        onClose={closeCircleComposer}
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">
              {composerMode === 'follow-up'
                ? 'New follow-up'
                : circleTaskType === 'focus'
                ? 'New focus'
                : circleTaskType === 'short_term'
                ? 'New short-term task'
                : 'New long-term task'}
            </p>
            <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
              {composerMode === 'follow-up'
                ? 'Create a follow-up and assign it to this person.'
                : circleTaskType === 'focus'
                ? 'Create a priority for the day and assign it to this person.'
                : circleTaskType === 'short_term'
                ? 'Create a short-term task and assign it to this person.'
                : 'Create a longer-horizon task and assign it to this person.'}
            </p>
          </div>
          <button
            type="button"
            onClick={closeCircleComposer}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            aria-label="Close task composer"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {composerMode === 'task' && (
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'focus' as const, label: 'Focus' },
                { id: 'short_term' as const, label: 'Short-term' },
                { id: 'long_term' as const, label: 'Long-term' },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setCircleTaskType(option.id);
                    if (option.id !== 'long_term') setComposerDueDate('');
                  }}
                  className={
                    option.id === circleTaskType
                      ? 'rounded-full border border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-primary)]'
                      : 'rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <input
            autoFocus
            value={composerTitle}
            onChange={(event) => setComposerTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveCircleComposer();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closeCircleComposer();
              }
            }}
            placeholder="Task title"
            className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
          />
          {(composerMode === 'follow-up' || circleTaskType === 'long_term') && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[var(--ledger-text-secondary)]">
                Due date
              </span>
              <input
                type="date"
                value={composerDueDate}
                onChange={(event) => setComposerDueDate(event.target.value)}
                className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
              />
            </label>
          )}
          <div className="space-y-1">
            <span className="text-xs font-medium text-[var(--ledger-text-secondary)]">
              Assign to
            </span>
            <div className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)]">
              {selectedPersonDetails?.name}
            </div>
          </div>
          {composerError && (
            <p className="rounded-lg border border-[color:rgba(255,95,64,0.2)] bg-[color:rgba(255,95,64,0.06)] px-3 py-2 text-xs text-[var(--ledger-accent)]">
              {composerError}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <button
            type="button"
            onClick={closeCircleComposer}
            className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-sm font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void saveCircleComposer()}
            disabled={!composerTitle.trim() || isSavingComposer}
            className="rounded-lg bg-[var(--ledger-accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
          >
            {isSavingComposer
              ? 'Saving…'
              : composerMode === 'follow-up'
              ? 'Create follow-up'
              : circleTaskType === 'focus'
              ? 'Add focus'
              : circleTaskType === 'short_term'
              ? 'Add task'
              : 'Add long-term task'}
          </button>
        </div>
      </ModalOverlay>

      {showMoreMenu && selectedPersonDetails && (
        <div
          ref={moreMenuRef}
          style={moreMenuStyle ?? undefined}
          className="z-50 overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
        >
          <button
            type="button"
            onClick={() => {
              void copyPersonEmail(selectedPersonDetails);
              setShowMoreMenu(false);
            }}
            className="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
          >
            <Copy size={14} className="shrink-0" />
            Copy email
          </button>
          <button
            type="button"
            onClick={() => {
              openActivity();
              setShowMoreMenu(false);
            }}
            className="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
          >
            <Clock3 size={14} className="shrink-0" />
            Open activity
          </button>
          <button
            type="button"
            onClick={() => {
              if (sharedProjectFromWork) openSharedProject(sharedProjectFromWork.id);
              setShowMoreMenu(false);
            }}
            className="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
          >
            <Folder size={14} className="shrink-0" />
            Open shared project
          </button>
        </div>
      )}
    </div>
  );
};

export default CircleWindow;
