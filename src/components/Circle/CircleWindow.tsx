import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Filter,
  Folder,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ModuleHeaderActionButton, ModuleHeaderSegmentedButton, ModuleHeaderSegmentedGroup, ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useWorkspaceRealtimeRefresh } from '../../hooks/useWorkspaceRealtimeRefresh';

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

const circleTheme = {
  shell:
    'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] text-[var(--ledger-text-primary)] shadow-none',
  body: 'flex min-h-0 flex-1 overflow-hidden',
  leftPane:
    'flex h-full w-[300px] min-w-[260px] max-w-[320px] shrink-0 flex-col border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)]',
  leftPaneHeader:
    'border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-[11px] font-medium text-[var(--ledger-text-muted)]',
  leftList: 'min-h-0 flex-1 overflow-y-auto px-2 py-2',
  row:
    'group flex w-full items-start gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-[var(--ledger-surface-hover)]',
  rowSelected: 'bg-[var(--ledger-surface-selected)] hover:bg-[var(--ledger-surface-selected)]',
  rowTitle: 'text-[13px] font-medium leading-5 text-[var(--ledger-text-primary)]',
  rowMeta: 'text-[11px] leading-4 text-[var(--ledger-text-muted)]',
  rowMetaStrong: 'text-[11px] font-medium leading-4 text-[var(--ledger-text-secondary)]',
  content: 'min-w-0 flex-1 overflow-y-auto px-5 py-5 lg:px-6',
  contentInner: 'mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5',
  panel:
    'rounded-[22px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]',
  sectionTitle: 'text-xs font-medium text-[var(--ledger-text-primary)]',
  sectionLabel:
    'text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ledger-text-muted)]',
  sectionBody: 'space-y-0',
  emptyText: 'text-sm font-light italic text-[var(--ledger-text-muted)]',
  emptyBody: 'text-sm font-light text-[var(--ledger-text-muted)]',
  chip:
    'inline-flex h-6 items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)]',
  headerMeta: 'text-[11px] text-[var(--ledger-text-muted)]',
  subtleButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  compactButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  actionButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  primaryButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--ledger-accent)] px-3 text-[11px] font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)]',
  mutedButton:
    'inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] px-3 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  sectionRow:
    'group flex w-full items-start justify-between gap-3 rounded-2xl border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-left transition last:border-b-0 hover:bg-[var(--ledger-surface-hover)]',
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

const CircleAvatar = ({ person }: { person: CirclePersonSummary }) => {
  const initials = getInitials(person.name, person.email);
  if (person.avatar_url) {
    return (
      <img
        src={person.avatar_url}
        alt={person.name}
        className="h-8 w-8 shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] object-cover"
      />
    );
  }
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[10px] font-semibold text-[var(--ledger-text-secondary)]">
      {initials}
    </span>
  );
};

const CompactStat = ({
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
  const content = (
    <>
      <span className="text-[11px] text-[var(--ledger-text-muted)]">{label}</span>
      <span className={`text-xs font-semibold ${active ? 'text-[var(--ledger-accent)]' : 'text-[var(--ledger-text-primary)]'}`}>
        {value}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-[110px] flex-col items-start rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2 text-left transition hover:bg-[var(--ledger-surface-hover)]"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex min-w-[110px] flex-col items-start rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2">
      {content}
    </div>
  );
};

const SectionCard = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <section className={circleTheme.panel}>
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
      <h3 className={circleTheme.sectionTitle}>{title}</h3>
      {action}
    </div>
    <div>{children}</div>
  </section>
);

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
        {meta && typeof meta === 'string' ? (
          <p className={circleTheme.rowMeta}>{meta}</p>
        ) : (
          meta
        )}
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

export const CircleWindow = () => {
  const api = useApi();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();

  const [people, setPeople] = useState<CirclePersonSummary[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<CirclePersonSummary | null>(null);
  const [selectedWork, setSelectedWork] = useState<CirclePersonDetailPayload | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<CirclePersonProjectsPayload | null>(null);
  const [selectedFollowUps, setSelectedFollowUps] = useState<CirclePersonFollowUpsPayload | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<CirclePersonActivityPayload | null>(null);
  const [activeTab, setActiveTab] = useState<CircleDetailTab>('overview');
  const [listTab, setListTab] = useState<CircleListTab>('all');
  const [displayMode, setDisplayMode] = useState<CircleDisplayMode>('newest_active');
  const [searchQuery, setSearchQuery] = useState('');
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

  const loadTokenRef = useRef(0);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const loadPeople = async () => {
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

    const token = ++loadTokenRef.current;
    setIsLoadingPeople(true);
    setError(null);

    try {
      const payload = (await api.getPeople()) as { people?: CirclePersonSummary[] };
      if (loadTokenRef.current !== token) return;

      const nextPeople = Array.isArray(payload?.people) ? payload.people : [];
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
      if (loadTokenRef.current !== token) return;
      setPeople([]);
      setSelectedPersonId(null);
      setSelectedPerson(null);
      setSelectedWork(null);
      setSelectedProjects(null);
      setSelectedFollowUps(null);
      setSelectedActivity(null);
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load people.');
    } finally {
      if (loadTokenRef.current === token) {
        setIsLoadingPeople(false);
      }
    }
  };

  const loadSelectedPerson = async (personId: string) => {
    if (!activeWorkspaceId) return;
    const token = ++loadTokenRef.current;
    setIsLoadingSelected(true);
    setError(null);

    try {
      const [personPayload, workPayload, projectsPayload, followUpsPayload, activityPayload] =
        await Promise.all([
          api.getPerson(personId),
          api.getPersonWork(personId),
          api.getPersonProjects(personId),
          api.getPersonFollowUps(personId),
          api.getPersonActivity(personId),
        ]);

      if (loadTokenRef.current !== token) return;

      setSelectedPerson((personPayload as { person?: CirclePersonSummary })?.person ?? null);
      setSelectedWork(workPayload as CirclePersonDetailPayload);
      setSelectedProjects(projectsPayload as CirclePersonProjectsPayload);
      setSelectedFollowUps(followUpsPayload as CirclePersonFollowUpsPayload);
      setSelectedActivity(activityPayload as CirclePersonActivityPayload);
    } catch (fetchError) {
      if (loadTokenRef.current !== token) return;
      setSelectedPerson(null);
      setSelectedWork(null);
      setSelectedProjects(null);
      setSelectedFollowUps(null);
      setSelectedActivity(null);
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load person details.');
    } finally {
      if (loadTokenRef.current === token) {
        setIsLoadingSelected(false);
      }
    }
  };

  useEffect(() => {
    setPeople([]);
    setSelectedPersonId(null);
    setSelectedPerson(null);
    setSelectedWork(null);
    setSelectedProjects(null);
    setSelectedFollowUps(null);
    setSelectedActivity(null);
    setActiveTab('overview');
    setSearchQuery('');
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
    void loadPeople();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    if (!selectedPersonId) return;
    void loadSelectedPerson(selectedPersonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersonId, activeWorkspaceId, api]);

  useWorkspaceRealtimeRefresh({
    workspaceId: activeWorkspaceId,
    tables: ['tasks', 'projects', 'workspace_audit_logs', 'workspace_team_members', 'workspace_members', 'person_preferences'],
    enabled: Boolean(activeWorkspaceId),
    onChange: () => {
      void loadPeople();
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

  const currentWorkspaceName = activeWorkspace?.name ?? 'Workspace';
  const selectedPersonDetails = selectedPerson ?? people.find((person) => person.id === selectedPersonId) ?? null;
  const selectedPersonTasks = selectedWork?.assigned_tasks ?? [];
  const selectedProjectsRows = selectedProjects?.shared_projects ?? [];
  const selectedFollowUpItems = selectedFollowUps?.items ?? [];
  const selectedActivityRows = selectedActivity?.activity ?? [];

  const selectedPersonPrimaryTeam = selectedPersonDetails?.teams?.[0]?.name ?? null;
  const selectedPersonDisplayRole = titleCase(selectedPersonDetails?.role ?? 'member');

  const personSearchText = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query;
  }, [searchQuery]);

  const visiblePeople = useMemo(() => {
    const query = personSearchText;
    const todayThreshold = Date.now() - 1000 * 60 * 60 * 24 * 14;

    const matchesFilters = (person: CirclePersonSummary) => {
      if (query) {
        const teamText = person.teams.map((team) => team.name).join(' ').toLowerCase();
        const searchText = [person.name, person.email, person.role, teamText].filter(Boolean).join(' ').toLowerCase();
        if (!searchText.includes(query)) return false;
      }

      if (filters.teamId && !person.teams.some((team) => team.id === filters.teamId)) return false;
      if (filters.role && String(person.role ?? '').toLowerCase() !== filters.role) return false;
      if (filters.hasOpenTasks && person.open_task_count <= 0) return false;
      if (filters.hasSharedProjects && person.shared_project_count <= 0) return false;
      if (filters.waitingOn && person.waiting_on_count <= 0) return false;
      if (filters.pinned && !person.is_pinned) return false;

      switch (listTab) {
        case 'active':
          return person.open_task_count > 0 || Date.parse(person.last_active_at ?? '') >= todayThreshold;
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

    const sortPeople = (a: CirclePersonSummary, b: CirclePersonSummary) => {
      if (displayMode === 'team') {
        return (
          String(a.teams[0]?.name ?? '').localeCompare(String(b.teams[0]?.name ?? '')) ||
          String(a.name).localeCompare(String(b.name))
        );
      }
      if (displayMode === 'role') {
        return String(a.role).localeCompare(String(b.role)) || String(a.name).localeCompare(String(b.name));
      }
      if (displayMode === 'open_work') {
        return (b.open_task_count - a.open_task_count) || String(a.name).localeCompare(String(b.name));
      }
      if (displayMode === 'recent_activity') {
        return String(b.last_active_at ?? '').localeCompare(String(a.last_active_at ?? '')) || String(a.name).localeCompare(String(b.name));
      }
      if (displayMode === 'newest_active') {
        return String(b.last_active_at ?? '').localeCompare(String(a.last_active_at ?? '')) || String(a.name).localeCompare(String(b.name));
      }
      return String(a.name).localeCompare(String(b.name));
    };

    return [...people].filter(matchesFilters).sort(sortPeople);
  }, [displayMode, filters, listTab, people, personSearchText]);

  const sharedProjectFromWork = selectedProjectsRows[0] ?? null;

  const pinPerson = async (person: CirclePersonSummary) => {
    const nextPinned = !person.is_pinned;
    setPeople((prev) => prev.map((item) => (item.id === person.id ? { ...item, is_pinned: nextPinned } : item)));
    setSelectedPerson((current) => (current?.id === person.id ? { ...current, is_pinned: nextPinned } : current));
    try {
      const payload = (await api.updatePersonPreferences(person.id, { is_pinned: nextPinned })) as {
        preference?: { is_pinned?: boolean };
      };
      const resolvedPinned = Boolean(payload?.preference?.is_pinned);
      setPeople((prev) => prev.map((item) => (item.id === person.id ? { ...item, is_pinned: resolvedPinned } : item)));
      setSelectedPerson((current) =>
        current?.id === person.id ? { ...current, is_pinned: resolvedPinned } : current
      );
    } catch (saveError) {
      setPeople((prev) => prev.map((item) => (item.id === person.id ? { ...item, is_pinned: person.is_pinned } : item)));
      setSelectedPerson((current) =>
        current?.id === person.id ? { ...current, is_pinned: person.is_pinned } : current
      );
      setError(saveError instanceof Error ? saveError.message : 'Could not update pin.');
    }
  };

  const openTaskComposer = (person: CirclePersonSummary) => {
    void window.desktopWindow?.toggleModule('quick-task' as any, {
      kind: 'quick-task' as any,
      focusContext: buildPersonContext(person),
    } as any);
  };

  const openFollowUpComposer = (person: CirclePersonSummary) => {
    void window.desktopWindow?.toggleModule('quick-follow-up' as any, {
      kind: 'quick-follow-up' as any,
      focusContext: buildPersonContext(person),
    } as any);
  };

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

  const renderEmptySelection = () => (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Select a person to view their work and shared context.</p>
      <p className="mt-2 max-w-sm text-sm text-[var(--ledger-text-muted)]">
        Circle shows who you are working with, what you are waiting on, and what changed recently.
      </p>
    </div>
  );

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
                {selectedPersonDetails.is_pinned && (
                  <span className={circleTheme.chip}>
                    <Pin size={11} className="mr-1" />
                    Pinned
                  </span>
                )}
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
            <button
              type="button"
              onClick={() => void pinPerson(selectedPersonDetails)}
              className={circleTheme.primaryButton}
            >
              {selectedPersonDetails.is_pinned ? <PinOff size={11} /> : <Pin size={11} />}
              {selectedPersonDetails.is_pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
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
          <button type="button" onClick={() => openTaskComposer(selectedPersonDetails)} className={circleTheme.subtleButton}>
            <Plus size={11} />
            Assign task
          </button>
          <button type="button" onClick={() => openFollowUpComposer(selectedPersonDetails)} className={circleTheme.subtleButton}>
            <ArrowRight size={11} />
            Create follow-up
          </button>
          <button
            type="button"
            onClick={() => {
              if (sharedProjectFromWork) openSharedProject(sharedProjectFromWork.id);
            }}
            disabled={!sharedProjectFromWork}
            className={`${circleTheme.subtleButton} ${!sharedProjectFromWork ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            <Folder size={11} />
            Open shared project
          </button>
          <button
            type="button"
            onClick={() => void pinPerson(selectedPersonDetails)}
            className={circleTheme.subtleButton}
          >
            <Pin size={11} />
            {selectedPersonDetails.is_pinned ? 'Pinned' : 'Pin'}
          </button>
        </div>

        <div className="grid gap-2 border-t border-[color:var(--ledger-border-subtle)] px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
          <CompactStat
            label="Open tasks"
            value={selectedWork?.summary.open_task_count ?? selectedPersonDetails.open_task_count}
            active={activeTab === 'assigned'}
            onClick={() => setActiveTab('assigned')}
          />
          <CompactStat
            label="Shared projects"
            value={selectedWork?.summary.shared_project_count ?? selectedPersonDetails.shared_project_count}
            active={activeTab === 'projects'}
            onClick={() => setActiveTab('projects')}
          />
          <CompactStat
            label="Follow-ups"
            value={selectedWork?.summary.follow_up_count ?? selectedPersonDetails.follow_up_count}
            active={activeTab === 'followups'}
            onClick={() => setActiveTab('followups')}
          />
          <CompactStat
            label="Waiting on"
            value={selectedWork?.summary.waiting_on_count ?? selectedPersonDetails.waiting_on_count}
            active={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
          />
        </div>
      </section>
    );
  };

  const renderTaskRow = (task: CirclePersonTask) => (
    <Row
      key={task.id}
      title={task.title}
      meta={
        <p className={circleTheme.rowMeta}>
          {task.status_label}
          {task.project_name ? ` · ${task.project_name}` : ''}
          {task.due_date ? ` · Due ${formatShortDate(task.due_date)}` : ''}
          {task.is_overdue ? ' · Overdue' : ''}
        </p>
      }
      right={
        <div className="space-y-1 text-right">
          <p className={circleTheme.rowMetaStrong}>{formatTaskPriority(task.priority)}</p>
          <p className={circleTheme.rowMeta}>{task.project_status ?? 'Task'}</p>
        </div>
      }
      icon={<CheckCircle2 size={13} className={task.is_open ? 'text-[var(--ledger-text-muted)]' : 'text-[var(--ledger-accent)]'} />}
      onClick={() => openTask(task.id)}
    />
  );

  const renderProjectRow = (project: CirclePersonProject) => (
    <Row
      key={project.id}
      title={project.title}
      meta={
        <p className={circleTheme.rowMeta}>
          {project.status}
          {project.due_date ? ` · Due ${formatShortDate(project.due_date)}` : ''}
          {project.next_action_count ? ` · ${project.next_action_count} next` : ''}
        </p>
      }
      right={
        <div className="flex flex-col items-end gap-1">
          <p className={circleTheme.rowMetaStrong}>{project.role}</p>
          <div className="h-1.5 w-24 rounded-full bg-[var(--ledger-surface-muted)]">
            <div
              className="h-1.5 rounded-full"
              style={{ width: `${Math.max(4, Math.min(100, project.progress))}%`, backgroundColor: project.color }}
            />
          </div>
        </div>
      }
      icon={<div className="mt-0.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} />}
      onClick={() => openSharedProject(project.id)}
    />
  );

  const renderActivityRow = (activity: CirclePersonActivity) => (
    <Row
      key={activity.id}
      title={activity.title}
      meta={
        <p className={circleTheme.rowMeta}>
          {activity.detail}
          {activity.timestamp ? ` · ${formatActivityDate(activity.timestamp)}` : ''}
        </p>
      }
      right={<p className={circleTheme.rowMetaStrong}>{formatRelativeActive(activity.timestamp)}</p>}
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

    return (
      <div className="space-y-4">
        <SectionCard title="Needs attention" action={<button type="button" onClick={() => setActiveTab('assigned')} className={circleTheme.subtleButton}>View all</button>}>
          {needsAttention.length > 0 ? (
            needsAttention.map(renderTaskRow)
          ) : (
            <p className="px-4 py-4 text-sm text-[var(--ledger-text-muted)]">No urgent work right now.</p>
          )}
        </SectionCard>

        <SectionCard title="Assigned work" action={<button type="button" onClick={() => setActiveTab('assigned')} className={circleTheme.subtleButton}>View all</button>}>
          {tasks.length > 0 ? tasks.map(renderTaskRow) : <p className="px-4 py-4 text-sm text-[var(--ledger-text-muted)]">No open work assigned.</p>}
        </SectionCard>

        <SectionCard title="Shared projects" action={<button type="button" onClick={() => setActiveTab('projects')} className={circleTheme.subtleButton}>View all</button>}>
          {sharedProjects.length > 0 ? sharedProjects.map(renderProjectRow) : <p className="px-4 py-4 text-sm text-[var(--ledger-text-muted)]">No shared projects yet.</p>}
        </SectionCard>

        <SectionCard title="Follow-ups" action={<button type="button" onClick={() => setActiveTab('followups')} className={circleTheme.subtleButton}>View all</button>}>
          {selectedFollowUpItems.length > 0 ? (
            <p className="px-4 py-4 text-sm text-[var(--ledger-text-muted)]">Follow-up records will appear here once that system is available.</p>
          ) : (
            <div className="px-4 py-4">
              <p className="text-sm text-[var(--ledger-text-muted)]">No follow-ups with this person yet.</p>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent activity" action={<button type="button" onClick={() => setActiveTab('activity')} className={circleTheme.subtleButton}>View all</button>}>
          {activity.length > 0 ? activity.map(renderActivityRow) : <p className="px-4 py-4 text-sm text-[var(--ledger-text-muted)]">No recent activity.</p>}
        </SectionCard>
      </div>
    );
  };

  const renderAssignedWork = () => (
    <div>
      {selectedPersonTasks.length > 0 ? (
        selectedPersonTasks.map(renderTaskRow)
      ) : (
        <p className="px-4 py-4 text-sm text-[var(--ledger-text-muted)]">No open work assigned.</p>
      )}
    </div>
  );

  const renderProjects = () => (
    <div>
      {selectedProjectsRows.length > 0 ? (
        selectedProjectsRows.map(renderProjectRow)
      ) : (
        <p className="px-4 py-4 text-sm text-[var(--ledger-text-muted)]">No shared projects yet.</p>
      )}
    </div>
  );

  const renderFollowUps = () => (
    <div className="space-y-3 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--ledger-text-muted)]">No follow-ups with this person yet.</p>
        <button
          type="button"
          onClick={() => selectedPersonDetails && openFollowUpComposer(selectedPersonDetails)}
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
    <div>
      {selectedActivityRows.length > 0 ? (
        selectedActivityRows.map(renderActivityRow)
      ) : (
        <p className="px-4 py-4 text-sm text-[var(--ledger-text-muted)]">No recent activity.</p>
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

  return (
    <div className={circleTheme.shell}>
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
            <div className="flex h-7 min-w-[178px] items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5">
              <Search size={11} className="text-[var(--ledger-text-muted)]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search people"
                className="w-full bg-transparent text-[11px] text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)]"
              />
            </div>
            <div className="relative" ref={filterMenuRef}>
              <ModuleHeaderActionButton
                variant="strip"
                iconOnly
                square
                title="Filter people"
                ariaLabel="Filter people"
                icon={<Filter size={12} />}
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
                      <label className={circleTheme.sectionLabel}>Team</label>
                      <select
                        value={selectedTeamValue}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            teamId: event.target.value === 'all' ? null : event.target.value,
                          }))
                        }
                        className="mt-1 h-8 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 text-[11px] text-[var(--ledger-text-primary)] outline-none"
                      >
                        <option value="all">All teams</option>
                        {teamOptions.map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={circleTheme.sectionLabel}>Role</label>
                      <select
                        value={selectedRoleValue}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            role: event.target.value === 'all' ? null : event.target.value,
                          }))
                        }
                        className="mt-1 h-8 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 text-[11px] text-[var(--ledger-text-primary)] outline-none"
                      >
                        <option value="all">All roles</option>
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </div>
                    {[
                      { key: 'hasOpenTasks', label: 'Has open tasks' },
                      { key: 'hasSharedProjects', label: 'Has shared projects' },
                      { key: 'waitingOn', label: 'Waiting on' },
                      { key: 'pinned', label: 'Pinned' },
                    ].map((item) => (
                      <label key={item.key} className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-[11px] text-[var(--ledger-text-secondary)]">
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
                      className={circleTheme.mutedButton}
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
                icon={<SlidersHorizontal size={12} />}
                onClick={() => {
                  setShowDisplayMenu((current) => !current);
                  setShowFilterMenu(false);
                }}
              >
                Display
              </ModuleHeaderActionButton>
              {showDisplayMenu && (
                <div className="absolute right-0 top-9 z-50 w-56 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-2 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                  {displayModes.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setDisplayMode(option.id)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[11px] transition hover:bg-[var(--ledger-surface-hover)] ${
                        displayMode === option.id ? 'text-[var(--ledger-text-primary)]' : 'text-[var(--ledger-text-secondary)]'
                      }`}
                    >
                      <span>{option.label}</span>
                      {displayMode === option.id && <span className="text-[var(--ledger-accent)]">•</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        }
      />

      <div className={circleTheme.body}>
        <aside className={circleTheme.leftPane}>
          <div className={circleTheme.leftPaneHeader}>
            {isLoadingPeople ? 'Loading people…' : `${visiblePeople.length} people`}
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
                      setSelectedPersonId(person.id);
                      setShowFilterMenu(false);
                      setShowDisplayMenu(false);
                      setShowMoreMenu(false);
                    }}
                    icon={<CircleAvatar person={person} />}
                    title={person.name}
                    meta={
                      <div className="space-y-0.5">
                        <p className={circleTheme.rowMeta}>
                          {titleCase(person.role)}
                          {teamLabel ? ` · ${teamLabel}` : ''}
                        </p>
                        <p className={circleTheme.rowMetaStrong}>{secondary}</p>
                      </div>
                    }
                    right={
                      <div className="flex flex-col items-end gap-1">
                        {person.is_pinned && <Pin size={11} className="text-[var(--ledger-accent)]" />}
                        <p className={circleTheme.rowMeta}>{formatRelativeActive(person.last_active_at)}</p>
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

                <SectionCard
                  title="Person workspace"
                  action={
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
                  }
                >
                  {isLoadingSelected ? (
                    <p className="px-4 py-5 text-sm text-[var(--ledger-text-muted)]">Loading person details…</p>
                  ) : activeTab === 'overview' ? (
                    <div className="space-y-4 px-0 py-0">{renderOverview()}</div>
                  ) : activeTab === 'assigned' ? (
                    renderAssignedWork()
                  ) : activeTab === 'projects' ? (
                    renderProjects()
                  ) : activeTab === 'followups' ? (
                    renderFollowUps()
                  ) : (
                    renderActivity()
                  )}
                </SectionCard>
              </>
            ) : (
              <section className={circleTheme.panel}>{renderEmptySelection()}</section>
            )}
          </div>
        </main>
      </div>

      {showMoreMenu && selectedPersonDetails && (
        <div
          ref={moreMenuRef}
          className="absolute right-6 top-20 z-50 w-56 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-2 shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
        >
          <button
            type="button"
            onClick={() => {
              void copyPersonEmail(selectedPersonDetails);
              setShowMoreMenu(false);
            }}
            className={circleTheme.subtleButton}
          >
            Copy email
          </button>
          <button
            type="button"
            onClick={() => {
              openActivity();
              setShowMoreMenu(false);
            }}
            className={circleTheme.subtleButton}
          >
            Open activity
          </button>
          <button
            type="button"
            onClick={() => {
              if (sharedProjectFromWork) openSharedProject(sharedProjectFromWork.id);
              setShowMoreMenu(false);
            }}
            className={circleTheme.subtleButton}
          >
            Open shared project
          </button>
        </div>
      )}
    </div>
  );
};

export default CircleWindow;
