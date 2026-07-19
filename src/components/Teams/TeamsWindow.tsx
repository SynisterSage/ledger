import {
  Bell,
  Check,
  Circle,
  ChevronDown,
  Diamond,
  FileText,
  Filter,
  Hash,
  Inbox,
  CalendarDays,
  Link2,
  ListTodo,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ModuleHeaderActionButton,
  ModuleHeaderSegmentedButton,
  ModuleHeaderSegmentedGroup,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import { PinActionButton } from '../Common/PinActionButton';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { sidebarTheme } from '../Sidebar/sidebarTheme';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useWorkspaceRouteHistory } from '../../hooks/useWorkspaceRouteHistory';

type TeamMember = {
  id: string;
  name: string;
  email?: string | null;
  role?: 'lead' | 'member';
  initials: string;
};

type TeamDisplayMember = {
  id: string;
  name: string;
  email?: string | null;
  role?: 'lead' | 'member' | string | null;
  initials: string;
  avatar?: string | null;
  team_role?: string | null;
  is_lead?: boolean;
  open_task_count?: number | null;
  active_project_count?: number | null;
};

type Team = {
  id: string;
  name: string;
  identifier: string;
  description?: string;
  color: string;
  members: TeamMember[];
  assignedWork: TeamAssignedWorkItem[];
  assignedCount: number;
  milestoneCount: number;
  activeProjects: string[];
  ownedProjects?: Array<{ id: string; name: string; noteCount?: number; milestoneCount?: number }>;
  linkedNotes?: Array<{
    id: string;
    title: string;
    updatedAt?: string | null;
    projectId?: string | null;
    projectName?: string | null;
  }>;
  projectMilestones?: Array<{
    sourceId: string;
    title: string;
    projectName?: string | null;
    detail: string;
    assignedAt: string;
  }>;
  notes: string[];
  currentUserRole?: 'lead' | 'member' | 'viewer' | null;
};

type TeamOverviewResponse = {
  team: {
    id: string;
    name: string;
    identifier: string;
    color: string;
    workspace_id: string;
    member_count: number;
    lead_count: number;
    created_at?: string | null;
    updated_at?: string | null;
  };
  summary: {
    open_task_count: number;
    overdue_task_count: number;
    active_project_count: number;
    milestone_count: number;
    note_count: number;
    upcoming_event_count: number;
    intake_needs_review_count: number;
  };
  quick_links: Array<{ key: string; team_id: string; count: number | null }>;
  needs_attention: {
    overdue_tasks: Array<{
      id: string;
      title: string;
      status?: string | null;
      task_type?: string | null;
      priority?: string | null;
      due_date?: string | null;
      assignee?: string | null;
      project_id?: string | null;
      project?: { id: string; name?: string | null } | null;
      blocked?: boolean;
    }>;
    overdue_milestones: Array<{
      id: string;
      title: string;
      project?: string | null;
      due_date?: string | null;
    }>;
    intake_items: Array<{
      id: string;
      title: string;
      status?: string | null;
      source?: string | null;
      suggested_type?: string | null;
    }>;
  };
  active_projects: Array<{
    id: string;
    title: string;
    status?: string | null;
    progress?: number | null;
    lead?: string | null;
    due_date?: string | null;
    next_action_count?: number | null;
  }>;
  assigned_work: Array<{
    id: string;
    title: string;
    status?: string | null;
    task_type?: string | null;
    priority?: string | null;
    due_date?: string | null;
    assignee?: string | null;
    project_id?: string | null;
    project?: { id: string; name?: string | null } | null;
    blocked?: boolean;
    created_at?: string | null;
    updated_at?: string | null;
  }>;
  recent_notes: Array<{
    id: string;
    title: string;
    updatedAt?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    project_id?: string | null;
    section_id?: string | null;
    created_by?: string | null;
    updated_by?: string | null;
    linked_project?: { id: string; title?: string | null } | null;
  }>;
  upcoming: Array<{
    id: string;
    title: string;
    type: 'event' | 'reminder' | 'milestone';
    start?: string | null;
    end?: string | null;
    project?: { id: string; name?: string | null } | null;
    note_id?: string | null;
    owner?: string | null;
    status?: string | null;
  }>;
  members: Array<{
    id: string;
    name: string;
    email?: string | null;
    avatar?: string | null;
    role?: string | null;
    team_role?: string | null;
    is_lead?: boolean;
    open_task_count?: number | null;
    active_project_count?: number | null;
    joined_at?: string | null;
    last_active_at?: string | null;
  }>;
  recent_activity: Array<{
    id: string;
    actor?: string | null;
    actor_id?: string | null;
    action: string;
    object_type?: string | null;
    object_id?: string | null;
    object_title?: string | null;
    timestamp?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
};

type WorkspaceProjectRow = {
  id: string;
  name: string;
  owner_team_id?: string | null;
  noteCount?: number;
  milestoneCount?: number;
};

type WorkspaceTaskRow = {
  id: string;
  title: string;
  project_id?: string | null;
  project_name?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  status?: string | null;
  priority?: string | null;
  task_horizon?: 'today' | 'long_term' | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type WorkspaceMilestoneRow = {
  id: string;
  title: string;
  project_id: string;
  project_name?: string | null;
  milestone_date: string;
  type?: string | null;
  completed?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type WorkspaceNoteRow = {
  id: string;
  title: string;
  updated_at?: string | null;
};

type TeamAssignedWorkItem = {
  kind: 'task' | 'milestone';
  sourceId: string;
  title: string;
  projectId?: string | null;
  projectName: string;
  detail: string;
  dueDate?: string | null;
  priority?: string | null;
  typeLabel?: string | null;
  searchText: string;
  assignedAt: string;
};

type WorkspaceMemberPayload = {
  user_id: string;
  email?: string | null;
  full_name?: string | null;
  role?: string | null;
};

type TeamContextMenu = {
  teamId: string;
  x: number;
  y: number;
} | null;

type TeamResourceKind = 'project' | 'note' | 'task' | 'event' | 'external';

type TeamRowContextMenuState =
  | {
      kind: 'resource';
      resourceKind: TeamResourceKind;
      resourceId: string;
      x: number;
      y: number;
    }
  | {
      kind: 'note';
      noteId: string;
      x: number;
      y: number;
    }
  | {
      kind: 'task';
      taskId: string;
      x: number;
      y: number;
    }
  | {
      kind: 'project';
      projectId: string;
      x: number;
      y: number;
    }
  | {
      kind: 'upcoming';
      itemId: string;
      itemType: 'event' | 'reminder' | 'milestone';
      x: number;
      y: number;
    }
  | {
      kind: 'activity';
      activityId: string;
      x: number;
      y: number;
    }
  | {
      kind: 'member';
      memberId: string;
      x: number;
      y: number;
    }
  | {
      kind: 'intake';
      intakeId: string;
      x: number;
      y: number;
    };

type TeamSectionId =
  | 'pinnedResources'
  | 'teamNotes'
  | 'needsAttention'
  | 'activeProjects'
  | 'upcoming'
  | 'recentActivity';

const teamColors = ['#FF5F40', '#D97706', '#0F766E', '#2563EB', '#7C3AED', '#475569'];
const tabs = ['Overview', 'Notes', 'Members'] as const;

const teamsTheme = {
  shell:
    'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none',
  content: 'flex-1 min-h-0 overflow-auto bg-[var(--ledger-background)] px-4 py-4 lg:px-5 lg:py-5',
  page: 'mx-auto flex min-h-full w-full max-w-[1280px] flex-col gap-4',
  pageTitle:
    'text-[26px] font-medium leading-tight tracking-tight text-[var(--ledger-text-primary)]',
  subtitle: 'text-sm text-[var(--ledger-text-muted)]',
  action:
    'inline-flex h-8 items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  primaryAction:
    'inline-flex h-8 items-center gap-2 rounded-full border border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)] px-3 text-xs font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)]',
  panel:
    'overflow-hidden rounded-[20px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-none',
  section:
    'overflow-hidden rounded-[20px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-none',
  row: 'group grid w-full grid-cols-[minmax(220px,1.6fr)_minmax(170px,1.1fr)_92px_36px] items-center gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-2.5 text-left last:border-b-0 transition hover:bg-[var(--ledger-surface-hover)]',
  rowSelected: 'bg-[var(--ledger-surface-hover)] hover:bg-[var(--ledger-surface-hover)]',
  label: 'text-[11px] font-medium text-[var(--ledger-text-muted)]',
  title: 'text-[13px] font-medium text-[var(--ledger-text-primary)]',
  meta: 'text-[11px] leading-4 text-[var(--ledger-text-muted)]',
  chip: 'inline-flex h-5 items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-[10px] font-medium text-[var(--ledger-text-secondary)]',
  rightPanel: 'space-y-4 lg:sticky lg:top-0 lg:self-start',
  sectionTitle:
    'text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]',
  modalInput:
    'h-9 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)]',
};

const getInitials = (name: string, email?: string | null) => {
  const source = name.trim() || email?.split('@')[0] || 'Member';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const formatShortDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const todayKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const makeIdentifier = (name: string) => {
  const words = name
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words
    .slice(0, 4)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
};

const MemberAvatar = ({ member }: { member: { initials: string } }) => (
  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[10px] font-semibold text-[var(--ledger-text-secondary)]">
    {member.initials}
  </span>
);

const TeamBadge = ({ team }: { team: Team }) => (
  <span
    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
    style={{ backgroundColor: team.color }}
  >
    <Hash size={14} />
  </span>
);

const CompactButton = ({
  children,
  onClick,
  destructive = false,
}: {
  children: ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center justify-between rounded-xl px-2 py-2 text-left text-xs transition ${
      destructive
        ? 'text-[color:#B42318] hover:bg-[color:rgba(180,35,24,0.08)]'
        : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
    }`}
  >
    {children}
  </button>
);

const AvatarStack = ({
  members,
  maxVisible = 3,
  onMemberContextMenu,
}: {
  members: Array<{ id: string; name: string; avatar?: string | null }>;
  maxVisible?: number;
  onMemberContextMenu?: (
    member: { id: string; name: string; avatar?: string | null },
    event: ReactMouseEvent<HTMLElement>
  ) => void;
}) => {
  const visible = members.slice(0, maxVisible);
  return (
    <div className="flex items-center">
      {visible.map((member, index) => (
        <span
          key={member.id}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--ledger-surface-card)] bg-[var(--ledger-surface-muted)] text-[9px] font-semibold text-[var(--ledger-text-secondary)]"
          style={{ marginLeft: index === 0 ? 0 : -6 }}
          title={member.name}
          onContextMenu={
            onMemberContextMenu
              ? (event) => {
                  event.preventDefault();
                  onMemberContextMenu(member, event);
                }
              : undefined
          }
        >
          {member.avatar ? (
            <img
              src={member.avatar}
              alt={member.name}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            member.name
              .split(' ')
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()
          )}
        </span>
      ))}
      {members.length > visible.length ? (
        <span className="ml-1 inline-flex h-6 items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-[10px] font-medium text-[var(--ledger-text-secondary)]">
          +{members.length - visible.length}
        </span>
      ) : null}
    </div>
  );
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) return 'just now';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 'just now';
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
};

const TEAMS_CACHE_MAX_AGE = 45_000;

type TeamsWorkspaceCacheEntry = {
  updatedAt: number;
  members: TeamMember[];
  projects: WorkspaceProjectRow[];
  tasks: WorkspaceTaskRow[];
  milestones: WorkspaceMilestoneRow[];
  notes: WorkspaceNoteRow[];
  teams: Team[];
};

type TeamOverviewCacheEntry = {
  updatedAt: number;
  overview: TeamOverviewResponse;
};

type TeamNotesCacheEntry = {
  updatedAt: number;
  notes: TeamOverviewResponse['recent_notes'];
};

export const TeamsWindow = ({ focusContext }: { focusContext?: string } = {}) => {
  const api = useApi();
  const { user } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext();
  const { workspaceShellLayout } = useSidebar();
  const workspaceName = activeWorkspace?.name?.trim() || 'Workspace';
  const focusTeamId = useMemo(() => {
    const raw = String(focusContext ?? '').trim();
    if (raw.startsWith('team:')) {
      return raw.slice('team:'.length).trim() || null;
    }
    return null;
  }, [focusContext]);

  const [workspaceMembers, setWorkspaceMembers] = useState<TeamMember[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceProjectRow[]>([]);
  const [workspaceTasks, setWorkspaceTasks] = useState<WorkspaceTaskRow[]>([]);
  const [workspaceMilestones, setWorkspaceMilestones] = useState<WorkspaceMilestoneRow[]>([]);
  const [workspaceNotes, setWorkspaceNotes] = useState<WorkspaceNoteRow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const workspaceCacheRef = useRef(new Map<string, TeamsWorkspaceCacheEntry>());
  const workspaceMembersCacheRef = useRef(
    new Map<string, { updatedAt: number; members: TeamMember[] }>()
  );
  const teamOverviewCacheRef = useRef(new Map<string, TeamOverviewCacheEntry>());
  const teamNotesCacheRef = useRef(new Map<string, TeamNotesCacheEntry>());
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [openedTeamId, setOpenedTeamId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Overview');
  const [query, setQuery] = useState('');
  const [isNewTeamOpen, setIsNewTeamOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteTeamId, setInviteTeamId] = useState<string | null>(null);
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<TeamContextMenu>(null);
  const [resourceMenu, setResourceMenu] = useState<{ x: number; y: number } | null>(null);

  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [teamIdentifierDraft, setTeamIdentifierDraft] = useState('');
  const [teamDescriptionDraft, setTeamDescriptionDraft] = useState('');
  const [teamColorDraft, setTeamColorDraft] = useState(teamColors[0]);
  const [newTeamMemberToAddId, setNewTeamMemberToAddId] = useState('');
  const [newTeamMemberIds, setNewTeamMemberIds] = useState<string[]>([]);
  const [inviteEmailDraft, setInviteEmailDraft] = useState('');
  const [inviteRoleDraft, setInviteRoleDraft] = useState<'member' | 'admin'>('member');
  const [memberSearchDraft, setMemberSearchDraft] = useState('');
  const [assignWorkTeamId, setAssignWorkTeamId] = useState<string | null>(null);
  const [assignWorkSearch, setAssignWorkSearch] = useState('');
  const [assignWorkMode, setAssignWorkMode] = useState<'search' | 'new-task' | 'new-milestone'>(
    'search'
  );
  const [assignWorkSuccess, setAssignWorkSuccess] = useState<string | null>(null);
  const [taskComposerTitle, setTaskComposerTitle] = useState('');
  const [taskComposerProjectId, setTaskComposerProjectId] = useState('');
  const [taskComposerDueDate, setTaskComposerDueDate] = useState('');
  const [taskComposerPriority, setTaskComposerPriority] = useState<
    'low' | 'medium' | 'high' | 'urgent'
  >('medium');
  const [taskComposerHorizon, setTaskComposerHorizon] = useState<'today' | 'long_term'>(
    'long_term'
  );
  const [milestoneComposerTitle, setMilestoneComposerTitle] = useState('');
  const [milestoneComposerProjectId, setMilestoneComposerProjectId] = useState('');
  const [milestoneComposerDate, setMilestoneComposerDate] = useState('');
  const [milestoneComposerType, setMilestoneComposerType] = useState('Custom');
  const [assignWorkError, setAssignWorkError] = useState<string | null>(null);
  const [isProjectLinkOpen, setIsProjectLinkOpen] = useState(false);
  const [projectLinkSearch, setProjectLinkSearch] = useState('');
  const [projectLinkNameDraft, setProjectLinkNameDraft] = useState('');
  const [isNoteLinkOpen, setIsNoteLinkOpen] = useState(false);
  const [noteLinkSearch, setNoteLinkSearch] = useState('');
  const [noteLinkTitleDraft, setNoteLinkTitleDraft] = useState('');
  const [teamOverview, setTeamOverview] = useState<TeamOverviewResponse | null>(null);
  const [teamOverviewLoading, setTeamOverviewLoading] = useState(false);
  const [teamOverviewError, setTeamOverviewError] = useState<string | null>(null);
  const [teamNotes, setTeamNotes] = useState<TeamOverviewResponse['recent_notes']>([]);
  const [teamNotesLoading, setTeamNotesLoading] = useState(false);
  const [teamNotesQuery, setTeamNotesQuery] = useState('');
  const [teamRowContextMenu, setTeamRowContextMenu] = useState<TeamRowContextMenuState | null>(
    null
  );
  const [collapsedTeamSections, setCollapsedTeamSections] = useState<
    Record<TeamSectionId, boolean>
  >({
    pinnedResources: false,
    teamNotes: false,
    needsAttention: false,
    activeProjects: false,
    upcoming: false,
    recentActivity: false,
  });

  const openTeamDetail = (teamId: string) => {
    setSelectedTeamId(teamId);
    setOpenedTeamId(teamId);
    setActiveTab('Overview');
    setTeamNotesQuery('');
  };

  const goBackToTeamsList = () => {
    setOpenedTeamId(null);
  };

  useEffect(() => {
    setSelectedTeamId(focusTeamId);
    setOpenedTeamId(focusTeamId);
  }, [focusTeamId]);

  useEffect(() => {
    if (focusContext !== 'try:invite-member') return;
    setInviteTeamId(null);
    setIsInviteOpen(true);
  }, [focusContext]);

  useWorkspaceRouteHistory(
    {
      kind: 'teams',
      focusContext: openedTeamId ? `team:${openedTeamId}` : null,
    },
    true
  );

  useEffect(() => {
    let cancelled = false;

    const loadMembers = async () => {
      if (!activeWorkspaceId) {
        setWorkspaceMembers([]);
        return;
      }

      const cached = workspaceMembersCacheRef.current.get(activeWorkspaceId);
      if (cached) {
        setWorkspaceMembers(cached.members);
        if (Date.now() - cached.updatedAt < TEAMS_CACHE_MAX_AGE) return;
      }

      try {
        const payload = (await api.getWorkspaceMembers(activeWorkspaceId)) as {
          members?: WorkspaceMemberPayload[];
        };
        if (cancelled) return;

        const members = Array.isArray(payload?.members)
          ? payload.members.map((member) => {
              const name =
                member.full_name?.trim() || member.email?.split('@')[0] || 'Workspace member';
              return {
                id: member.user_id,
                name,
                email: member.email ?? null,
                initials: getInitials(name, member.email),
                role: member.user_id === user?.id ? ('lead' as const) : undefined,
              };
            })
          : [];

        workspaceMembersCacheRef.current.set(activeWorkspaceId, {
          updatedAt: Date.now(),
          members,
        });
        setWorkspaceMembers(members);
      } catch {
        setWorkspaceMembers([]);
      }
    };

    void loadMembers();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, user?.id]);

  useEffect(() => {
    let cancelled = false;

    const loadWorkspaceWork = async () => {
      if (!activeWorkspaceId) {
        setWorkspaceProjects([]);
        setWorkspaceTasks([]);
        setWorkspaceMilestones([]);
        setWorkspaceNotes([]);
        return;
      }

      const cached = workspaceCacheRef.current.get(activeWorkspaceId);
      if (cached) {
        setWorkspaceProjects(cached.projects);
        setWorkspaceTasks(cached.tasks);
        setWorkspaceMilestones(cached.milestones);
        setWorkspaceNotes(cached.notes);
        if (Date.now() - cached.updatedAt < TEAMS_CACHE_MAX_AGE) return;
      }

      try {
        const [projectsPayload, tasksPayload, milestonesPayload, notesPayload] = await Promise.all([
          api.getProjects({ includeCompleted: true }),
          api.getTasks(),
          api.getWorkspaceProjectMilestones(),
          api.getNotes(),
        ]);

        if (cancelled) return;

        const projects = Array.isArray(projectsPayload)
          ? projectsPayload.map((project) => ({
              id: String(project.id),
              name: String(project.name ?? ''),
              owner_team_id: (project as { owner_team_id?: string | null }).owner_team_id ?? null,
              noteCount: Number((project as { noteCount?: number }).noteCount ?? 0),
              milestoneCount: Number((project as { milestoneCount?: number }).milestoneCount ?? 0),
            }))
          : [];

        const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

        const tasks = Array.isArray(tasksPayload)
          ? (tasksPayload as WorkspaceTaskRow[])
              .filter((task) => String(task.status ?? '').toLowerCase() !== 'completed')
              .map((task) => ({
                ...task,
                project_name:
                  task.project_name ??
                  (task.project_id ? projectNameById.get(task.project_id) ?? null : null),
              }))
          : [];

        const milestones = Array.isArray(milestonesPayload)
          ? (milestonesPayload as WorkspaceMilestoneRow[]).map((milestone) => ({
              ...milestone,
              project_name:
                milestone.project_name ??
                (milestone.project_id ? projectNameById.get(milestone.project_id) ?? null : null),
            }))
          : [];

        const notes = Array.isArray(notesPayload)
          ? (notesPayload as Array<{ id: string; title: string; updated_at?: string | null }>).map(
              (note) => ({
                id: String(note.id),
                title: String(note.title ?? ''),
                updated_at: note.updated_at ?? null,
              })
            )
          : [];

        setWorkspaceProjects(projects);
        setWorkspaceTasks(tasks);
        setWorkspaceMilestones(milestones);
        setWorkspaceNotes(notes);
        const currentTeamsCache = workspaceCacheRef.current.get(activeWorkspaceId);
        workspaceCacheRef.current.set(activeWorkspaceId, {
          updatedAt: Date.now(),
          members: currentTeamsCache?.members ?? workspaceMembers,
          projects,
          tasks,
          milestones,
          notes,
          teams: currentTeamsCache?.teams ?? teams,
        });
      } catch {
        if (!cancelled) {
          setWorkspaceProjects([]);
          setWorkspaceTasks([]);
          setWorkspaceMilestones([]);
          setWorkspaceNotes([]);
        }
      }
    };

    void loadWorkspaceWork();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    let cancelled = false;

    const loadTeams = async () => {
      if (!activeWorkspaceId) {
        setTeams([]);
        setSelectedTeamId(null);
        setOpenedTeamId(null);
        return;
      }

      const cached = workspaceCacheRef.current.get(activeWorkspaceId);
      if (cached && cached.teams.length > 0) {
        setTeams(cached.teams);
        setSelectedTeamId((current) => {
          if (current && cached.teams.some((team) => team.id === current)) return current;
          if (focusTeamId && cached.teams.some((team) => team.id === focusTeamId))
            return focusTeamId;
          return null;
        });
        setOpenedTeamId(
          focusTeamId && cached.teams.some((team) => team.id === focusTeamId) ? focusTeamId : null
        );
        if (Date.now() - cached.updatedAt < TEAMS_CACHE_MAX_AGE && !focusTeamId) return;
      }

      try {
        const payload = (await api.getTeams({ includeArchived: Boolean(focusTeamId) })) as
          | { teams?: Team[] }
          | Team[];
        if (cancelled) return;

        const nextTeams = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.teams)
          ? payload.teams
          : [];
        const currentCache = workspaceCacheRef.current.get(activeWorkspaceId);
        workspaceCacheRef.current.set(activeWorkspaceId, {
          updatedAt: Date.now(),
          members: currentCache?.members ?? workspaceMembers,
          projects: currentCache?.projects ?? workspaceProjects,
          tasks: currentCache?.tasks ?? workspaceTasks,
          milestones: currentCache?.milestones ?? workspaceMilestones,
          notes: currentCache?.notes ?? workspaceNotes,
          teams: nextTeams,
        });
        setTeams(nextTeams);
        setSelectedTeamId((current) => {
          if (current && nextTeams.some((team) => team.id === current)) return current;
          if (focusTeamId && nextTeams.some((team) => team.id === focusTeamId)) return focusTeamId;
          return null;
        });
        setOpenedTeamId(
          focusTeamId && nextTeams.some((team) => team.id === focusTeamId) ? focusTeamId : null
        );
      } catch {
        if (!cancelled) {
          setTeams([]);
          setSelectedTeamId(null);
          setOpenedTeamId(null);
        }
      }
    };

    void loadTeams();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, focusTeamId]);

  useEffect(() => {
    if (!openedTeamId) {
      setTeamOverview(null);
      setTeamOverviewError(null);
      setTeamOverviewLoading(false);
      setTeamNotes([]);
      setTeamNotesLoading(false);
      return;
    }

    let cancelled = false;
    const cached = teamOverviewCacheRef.current.get(openedTeamId);
    if (cached) {
      setTeamOverview(cached.overview);
      setTeamOverviewLoading(false);
    } else {
      setTeamOverviewLoading(true);
    }
    setTeamOverviewError(null);

    if (cached && Date.now() - cached.updatedAt < TEAMS_CACHE_MAX_AGE) {
      return () => {
        cancelled = true;
      };
    }

    const loadOverview = async () => {
      try {
        const payload = (await api.getTeamOverview(openedTeamId)) as TeamOverviewResponse;
        if (cancelled) return;
        teamOverviewCacheRef.current.set(openedTeamId, {
          updatedAt: Date.now(),
          overview: payload,
        });
        setTeamOverview(payload);
      } catch (error) {
        if (!cancelled) {
          setTeamOverview(null);
          setTeamOverviewError(error instanceof Error ? error.message : 'Could not load team.');
        }
      } finally {
        if (!cancelled) setTeamOverviewLoading(false);
      }
    };

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [api, openedTeamId]);

  useEffect(() => {
    if (!openedTeamId || activeTab !== 'Notes') {
      if (!openedTeamId) setTeamNotes([]);
      return;
    }

    let cancelled = false;
    const notesCacheKey = `${openedTeamId}:${teamNotesQuery.trim().toLowerCase()}`;
    const cached = teamNotesCacheRef.current.get(notesCacheKey);
    if (cached) {
      setTeamNotes(cached.notes);
      setTeamNotesLoading(false);
    } else {
      setTeamNotesLoading(true);
    }

    if (cached && Date.now() - cached.updatedAt < TEAMS_CACHE_MAX_AGE) {
      return () => {
        cancelled = true;
      };
    }

    const loadNotes = async () => {
      try {
        const payload = (await api.getTeamNotes(openedTeamId, {
          recent: true,
          limit: 50,
          search: teamNotesQuery.trim() || undefined,
        })) as
          | { notes?: TeamOverviewResponse['recent_notes'] }
          | TeamOverviewResponse['recent_notes'];
        if (cancelled) return;
        const nextNotes = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.notes)
          ? payload.notes
          : [];
        teamNotesCacheRef.current.set(notesCacheKey, {
          updatedAt: Date.now(),
          notes: nextNotes,
        });
        setTeamNotes(nextNotes);
      } catch {
        if (!cancelled) setTeamNotes([]);
      } finally {
        if (!cancelled) setTeamNotesLoading(false);
      }
    };

    void loadNotes();

    return () => {
      cancelled = true;
    };
  }, [activeTab, api, openedTeamId, teamNotesQuery]);

  useEffect(() => {
    if (!assignWorkTeamId) {
      setAssignWorkSearch('');
      setAssignWorkMode('search');
      setAssignWorkSuccess(null);
      setAssignWorkError(null);
      setTaskComposerTitle('');
      setTaskComposerProjectId('');
      setTaskComposerDueDate('');
      setTaskComposerPriority('medium');
      setTaskComposerHorizon('long_term');
      setMilestoneComposerTitle('');
      setMilestoneComposerProjectId('');
      setMilestoneComposerDate('');
      setMilestoneComposerType('Custom');
      return;
    }

    setAssignWorkSearch('');
    setAssignWorkMode('search');
    setAssignWorkSuccess(null);
    setAssignWorkError(null);
    setTaskComposerTitle('');
    setTaskComposerProjectId('');
    setTaskComposerDueDate('');
    setTaskComposerPriority('medium');
    setTaskComposerHorizon('long_term');
    setMilestoneComposerTitle('');
    setMilestoneComposerProjectId('');
    setMilestoneComposerDate('');
    setMilestoneComposerType('Custom');
  }, [assignWorkTeamId]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!teamRowContextMenu) return;
    const close = () => setTeamRowContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTeamRowContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [teamRowContextMenu]);

  useEffect(() => {
    if (!resourceMenu) return;
    const close = () => setResourceMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setResourceMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [resourceMenu]);

  useEffect(() => {
    setTeamIdentifierDraft(makeIdentifier(teamNameDraft));
  }, [teamNameDraft]);

  useEffect(() => {
    if (!openedTeamId) return;
    setActiveTab('Overview');
    setTeamNotesQuery('');
  }, [openedTeamId]);

  const filteredTeams = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return teams;
    return teams.filter(
      (team) =>
        team.name.toLowerCase().includes(needle) ||
        team.identifier.toLowerCase().includes(needle) ||
        team.members.some((member) => member.name.toLowerCase().includes(needle))
    );
  }, [query, teams]);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const openedTeam = teams.find((team) => team.id === openedTeamId) ?? null;
  const currentTeam = openedTeam ?? selectedTeam;
  const addMemberTeam = teams.find((team) => team.id === addMemberTeamId) ?? null;
  const inviteTeam = teams.find((team) => team.id === inviteTeamId) ?? null;
  const overviewTeam = teamOverview?.team ?? null;
  const teamDisplayName = overviewTeam?.name ?? openedTeam?.name ?? selectedTeam?.name ?? 'Team';
  const teamDisplayIdentifier =
    overviewTeam?.identifier ?? openedTeam?.identifier ?? selectedTeam?.identifier ?? '';
  const teamMembers = useMemo<TeamDisplayMember[]>(() => {
    if (teamOverview?.members?.length) {
      return teamOverview.members.map((member) => ({
        ...member,
        initials: getInitials(member.name),
      }));
    }

    return (selectedTeam?.members ?? []).map((member) => ({
      ...member,
      initials: member.initials,
    }));
  }, [selectedTeam?.members, teamOverview?.members]);
  const teamOverviewMembersById = useMemo(() => {
    return new Map((teamOverview?.members ?? []).map((member) => [member.id, member]));
  }, [teamOverview?.members]);
  const teamQuickLinkCounts = new Map(
    (teamOverview?.quick_links ?? []).map((item) => [item.key, item.count ?? null])
  );
  const normalizeProjectStatus = (
    status?: string | null
  ): 'NotStarted' | 'InProgress' | 'Paused' | 'Completed' => {
    const value = String(status ?? '')
      .trim()
      .toLowerCase();
    if (!value) return 'NotStarted';
    if (value.includes('complete')) return 'Completed';
    if (value.includes('pause') || value.includes('archiv')) return 'Paused';
    if (value.includes('progress') || value.includes('in_') || value.includes('doing'))
      return 'InProgress';
    return 'NotStarted';
  };
  const formatProjectStatusLabel = (status?: string | null) => {
    switch (normalizeProjectStatus(status)) {
      case 'InProgress':
        return 'In Progress';
      case 'Paused':
        return 'Paused';
      case 'Completed':
        return 'Completed';
      case 'NotStarted':
      default:
        return 'Not Started';
    }
  };
  const teamActiveProjects = teamOverview?.active_projects ?? [];
  const teamUpcomingItems = teamOverview?.upcoming ?? [];
  const teamRecentActivity = teamOverview?.recent_activity ?? [];
  const teamOverviewNotes = teamOverview?.recent_notes ?? openedTeam?.linkedNotes ?? [];
  const teamMemberLabelById = useMemo(() => {
    const map = new Map<string, string>();
    (teamOverview?.members ?? []).forEach((member) => {
      map.set(member.id, member.name);
    });
    return map;
  }, [teamOverview?.members]);
  const teamProjectById = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        title: string;
        status?: string | null;
        progress?: number | null;
        lead?: string | null;
        due_date?: string | null;
        next_action_count?: number | null;
      }
    >();
    teamActiveProjects.forEach((project) => {
      map.set(project.id, {
        id: project.id,
        title: project.title,
        status: project.status ?? null,
        progress: project.progress ?? null,
        lead: project.lead ?? null,
        due_date: project.due_date ?? null,
        next_action_count: project.next_action_count ?? null,
      });
    });
    (openedTeam?.ownedProjects ?? []).forEach((project) => {
      if (!map.has(project.id)) {
        map.set(project.id, { id: project.id, title: project.name });
      }
    });
    return map;
  }, [openedTeam?.ownedProjects, teamActiveProjects]);
  const teamNoteById = useMemo(() => {
    const map = new Map<string, TeamOverviewResponse['recent_notes'][number]>();
    [...teamOverviewNotes, ...teamNotes].forEach((note) => {
      map.set(note.id, note);
    });
    return map;
  }, [teamNotes, teamOverviewNotes]);
  const teamTaskById = useMemo(() => {
    const map = new Map<string, TeamOverviewResponse['assigned_work'][number]>();
    [
      ...(teamOverview?.assigned_work ?? []),
      ...(teamOverview?.needs_attention.overdue_tasks ?? []),
    ].forEach((task) => {
      map.set(task.id, task);
    });
    return map;
  }, [teamOverview?.assigned_work, teamOverview?.needs_attention.overdue_tasks]);
  const teamUpcomingById = useMemo(() => {
    return new Map(teamUpcomingItems.map((item) => [item.id, item]));
  }, [teamUpcomingItems]);
  const teamActivityById = useMemo(() => {
    return new Map(teamRecentActivity.map((item) => [item.id, item]));
  }, [teamRecentActivity]);
  const teamLinkedNoteIds = useMemo(() => {
    return new Set((openedTeam?.linkedNotes ?? []).map((note) => note.id));
  }, [openedTeam?.linkedNotes]);
  const teamPinnedResources = useMemo(() => {
    const resources: Array<
      | {
          id: string;
          kind: 'project';
          title: string;
          meta: string;
          onClick: () => void;
        }
      | {
          id: string;
          kind: 'note';
          title: string;
          meta: string;
          onClick: () => void;
        }
    > = [];

    (openedTeam?.ownedProjects ?? []).slice(0, 4).forEach((project) => {
      resources.push({
        id: `project-${project.id}`,
        kind: 'project',
        title: project.name,
        meta: `${project.noteCount ?? 0} notes · ${project.milestoneCount ?? 0} milestones`,
        onClick: () =>
          void window.desktopWindow?.toggleModule('projects', {
            focusProjectId: project.id,
          }),
      });
    });

    (openedTeam?.linkedNotes ?? []).slice(0, 4).forEach((note) => {
      resources.push({
        id: `note-${note.id}`,
        kind: 'note',
        title: note.title,
        meta: note.projectName ? `${note.projectName} · project note` : 'Linked note',
        onClick: () =>
          void window.desktopWindow?.toggleModule('notes', {
            focusNoteId: note.id,
          }),
      });
    });

    return resources.slice(0, 6);
  }, [openedTeam?.linkedNotes, openedTeam?.ownedProjects]);

  const teamNeedAttentionItems = useMemo(() => {
    const overdueTasks = teamOverview?.needs_attention.overdue_tasks ?? [];
    const overdueMilestones = teamOverview?.needs_attention.overdue_milestones ?? [];
    const intakeItems = teamOverview?.needs_attention.intake_items ?? [];

    return [
      ...overdueTasks.map((item) => ({
        id: `task-${item.id}`,
        kind: 'task' as const,
        icon: <Circle size={12} />,
        title: item.title,
        meta: [
          item.status ? item.status.replace(/_/g, ' ') : null,
          item.project?.name ?? null,
          item.due_date ? formatShortDate(item.due_date) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        right: [item.assignee ?? null, item.task_type ? item.task_type : 'Task']
          .filter(Boolean)
          .join(' · '),
        onClick: () => openTaskById(item.id.replace(/^task-/, '')),
      })),
      ...overdueMilestones.map((item) => ({
        id: `milestone-${item.id}`,
        kind: 'milestone' as const,
        icon: <Diamond size={12} />,
        title: item.title,
        meta: [
          'Milestone',
          item.project ?? null,
          item.due_date ? formatShortDate(item.due_date) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        right: 'Milestone',
        onClick: () =>
          void window.desktopWindow?.toggleModule('projects', {
            focusContext: `team:${openedTeam?.id ?? ''}`,
          }),
      })),
      ...intakeItems.map((item) => ({
        id: `intake-${item.id}`,
        kind: 'intake' as const,
        icon: <Inbox size={12} />,
        title: item.title,
        meta: ['Intake', item.status ?? null, item.source ?? null].filter(Boolean).join(' · '),
        right: 'Review',
        onClick: () => void window.desktopWindow?.toggleModule('inbox'),
      })),
    ];
  }, [
    openedTeam?.id,
    teamOverview?.needs_attention.intake_items,
    teamOverview?.needs_attention.overdue_milestones,
    teamOverview?.needs_attention.overdue_tasks,
  ]);

  const availableMembers = useMemo(() => {
    if (!addMemberTeam) return [];
    const existing = new Set(addMemberTeam.members.map((member) => member.id));
    const needle = memberSearchDraft.trim().toLowerCase();
    return workspaceMembers.filter((member) => {
      if (existing.has(member.id)) return false;
      if (!needle) return true;
      return (
        member.name.toLowerCase().includes(needle) || member.email?.toLowerCase().includes(needle)
      );
    });
  }, [addMemberTeam, memberSearchDraft, workspaceMembers]);

  const newTeamMemberOptions = useMemo(() => {
    return workspaceMembers.filter((member) => member.id !== user?.id);
  }, [user?.id, workspaceMembers]);

  const resetNewTeamForm = () => {
    setTeamNameDraft('');
    setTeamIdentifierDraft('');
    setTeamDescriptionDraft('');
    setTeamColorDraft(teamColors[0]);
    setNewTeamMemberToAddId('');
    setNewTeamMemberIds([]);
  };

  const closeNewTeamComposer = () => {
    setIsNewTeamOpen(false);
    resetNewTeamForm();
  };

  const handleCreateTeam = async (event: FormEvent) => {
    event.preventDefault();
    const name = teamNameDraft.trim();
    const identifier = (teamIdentifierDraft.trim() || makeIdentifier(name)).toUpperCase();
    if (!name || !identifier) return;
    try {
      const created = (await api.createTeam({
        name,
        identifier,
        description: teamDescriptionDraft.trim() || null,
        color: teamColorDraft,
        member_ids: newTeamMemberIds,
      })) as { team?: Team };
      closeNewTeamComposer();
      await reloadTeams(created.team?.id ?? null);
    } catch (error) {
      console.error(error);
    }
  };

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault();
    const email = inviteEmailDraft.trim();
    if (!email || !activeWorkspaceId) return;

    try {
      await api.createWorkspaceInvitation(activeWorkspaceId, {
        email,
        role: inviteRoleDraft,
      });
      setInviteEmailDraft('');
      setInviteRoleDraft('member');
      setInviteTeamId(null);
      setIsInviteOpen(false);
    } catch (error) {
      console.error(error);
    }
  };

  const reloadTeams = async (focusTeamId?: string | null) => {
    const payload = (await api.getTeams()) as { teams?: Team[] } | Team[];
    const nextTeams = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.teams)
      ? payload.teams
      : [];
    if (activeWorkspaceId) {
      const currentCache = workspaceCacheRef.current.get(activeWorkspaceId);
      workspaceCacheRef.current.set(activeWorkspaceId, {
        updatedAt: Date.now(),
        members: currentCache?.members ?? workspaceMembers,
        projects: currentCache?.projects ?? workspaceProjects,
        tasks: currentCache?.tasks ?? workspaceTasks,
        milestones: currentCache?.milestones ?? workspaceMilestones,
        notes: currentCache?.notes ?? workspaceNotes,
        teams: nextTeams,
      });
    }
    setTeams(nextTeams);
    if (focusTeamId) {
      setSelectedTeamId(focusTeamId);
      setOpenedTeamId(focusTeamId);
      return;
    }
    setSelectedTeamId((current) =>
      current && nextTeams.some((team) => team.id === current) ? current : nextTeams[0]?.id ?? null
    );
    setOpenedTeamId((current) =>
      current && nextTeams.some((team) => team.id === current) ? current : null
    );
  };

  const addMemberToTeam = async (member: TeamMember) => {
    if (!addMemberTeamId) return;
    try {
      await api.addTeamMember(addMemberTeamId, {
        user_id: member.id,
        role: member.role ?? 'member',
      });
      setAddMemberTeamId(null);
      setMemberSearchDraft('');
      await reloadTeams(addMemberTeamId);
    } catch (error) {
      console.error(error);
    }
  };

  const deleteTeam = async (teamId: string) => {
    const team = teams.find((item) => item.id === teamId);
    if (!team) return;
    const confirmed = window.confirm(
      `Delete ${team.name}? Assigned work will remain in the workspace.`
    );
    if (!confirmed) return;
    try {
      await api.deleteTeam(teamId);
      setContextMenu(null);
      await reloadTeams();
    } catch (error) {
      console.error(error);
    }
  };

  const openInviteForTeam = (teamId: string | null) => {
    setInviteTeamId(teamId);
    setIsInviteOpen(true);
  };

  const assignWorkTeam = teams.find((team) => team.id === assignWorkTeamId) ?? null;
  const assignedWorkSet = new Set(
    (assignWorkTeam?.assignedWork ?? []).map((item) =>
      workItemKey({ kind: item.kind, sourceId: item.sourceId })
    )
  );
  const openedTeamProjectIds = new Set(
    (openedTeam?.ownedProjects ?? []).map((project) => project.id)
  );
  const projectLinkableItems = useMemo(() => {
    const needle = projectLinkSearch.trim().toLowerCase();
    return workspaceProjects.filter((project) => {
      if (openedTeamProjectIds.has(project.id)) return false;
      if (needle && !project.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [openedTeamProjectIds, projectLinkSearch, workspaceProjects]);
  const noteLinkableItems = useMemo(() => {
    const needle = noteLinkSearch.trim().toLowerCase();
    const linkedNoteIds = new Set((openedTeam?.linkedNotes ?? []).map((note) => note.id));
    return workspaceNotes.filter((note) => {
      if (linkedNoteIds.has(note.id)) return false;
      if (needle && !note.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [noteLinkSearch, openedTeam?.linkedNotes, workspaceNotes]);

  const workspaceWorkItems = useMemo(() => {
    const taskItems = workspaceTasks
      .map<TeamAssignedWorkItem>((task) => {
        const projectName = String(task.project_name ?? '').trim() || workspaceName;
        const dueLabel = formatShortDate(task.due_date);
        const detail = ['Task', projectName, dueLabel ? `Due ${dueLabel}` : null]
          .filter(Boolean)
          .join(' · ');
        return {
          kind: 'task' as const,
          sourceId: task.id,
          title: task.title,
          projectId: task.project_id ?? null,
          projectName,
          detail,
          dueDate: task.due_date ?? null,
          priority: task.priority ?? null,
          searchText: [task.title, projectName, detail, task.priority, task.task_horizon]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
          assignedAt: task.updated_at ?? task.created_at ?? new Date().toISOString(),
        };
      })
      .filter((item) => !assignedWorkSet.has(workItemKey(item)));

    const milestoneItems = workspaceMilestones
      .map<TeamAssignedWorkItem>((milestone) => {
        const projectName = String(milestone.project_name ?? '').trim() || workspaceName;
        const dueLabel = formatShortDate(milestone.milestone_date);
        const detail = ['Milestone', projectName, dueLabel ?? null].filter(Boolean).join(' · ');
        return {
          kind: 'milestone' as const,
          sourceId: milestone.id,
          title: milestone.title,
          projectId: milestone.project_id ?? null,
          projectName,
          detail,
          dueDate: milestone.milestone_date ?? null,
          typeLabel: milestone.type ?? 'Custom',
          searchText: [milestone.title, projectName, detail, milestone.type]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
          assignedAt: milestone.updated_at ?? milestone.created_at ?? new Date().toISOString(),
        };
      })
      .filter((item) => !assignedWorkSet.has(workItemKey(item)));

    return [...taskItems, ...milestoneItems].sort((left, right) =>
      String(right.assignedAt).localeCompare(String(left.assignedAt))
    );
  }, [assignedWorkSet, workspaceMilestones, workspaceName, workspaceTasks]);

  const filteredAssignableItems = useMemo(() => {
    const needle = assignWorkSearch.trim().toLowerCase();
    if (!needle) return workspaceWorkItems;
    return workspaceWorkItems.filter((item) => teamWorkItemMatches(item, needle));
  }, [assignWorkSearch, workspaceWorkItems]);

  const recentAssignableItems = useMemo(() => workspaceWorkItems.slice(0, 6), [workspaceWorkItems]);

  const hasAssignWorkQuery = assignWorkSearch.trim().length > 0;
  const visibleAssignWorkItems = hasAssignWorkQuery
    ? filteredAssignableItems
    : recentAssignableItems;

  const closeAssignWorkModal = () => {
    setAssignWorkTeamId(null);
    setAssignWorkSearch('');
    setAssignWorkMode('search');
    setAssignWorkSuccess(null);
    setAssignWorkError(null);
  };

  const openAssignWorkForTeam = (teamId: string) => {
    setAssignWorkTeamId(teamId);
    setAssignWorkSearch('');
    setAssignWorkMode('search');
    setAssignWorkSuccess(null);
    setAssignWorkError(null);
  };

  const assignExistingWorkItem = (item: TeamAssignedWorkItem) => {
    if (!assignWorkTeam) return;
    const assign = async () => {
      if (item.kind === 'task') {
        await api.updateTask(item.sourceId, {
          assigned_team_id: assignWorkTeam.id,
          assigned_to_team_id: assignWorkTeam.id,
        });
      } else {
        await api.updateProjectMilestone(item.sourceId, {
          assigned_team_id: assignWorkTeam.id,
          assigned_to_team_id: assignWorkTeam.id,
        });
      }
      setAssignWorkSuccess(`Assigned to ${assignWorkTeam.name}.`);
      setAssignWorkError(null);
      await reloadTeams(assignWorkTeam.id);
    };
    void assign().catch((error) => {
      setAssignWorkError(error instanceof Error ? error.message : 'Could not assign work.');
    });
  };

  const openAssignWorkToCurrentTeam = () => {
    if (!openedTeam) return;
    openAssignWorkForTeam(openedTeam.id);
  };

  const assignTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!assignWorkTeam) return;

    const title = taskComposerTitle.trim();
    if (!title) return;

    try {
      const dueDate =
        taskComposerHorizon === 'today' ? todayKey() : taskComposerDueDate.trim() || null;
      await api.createTask({
        title,
        project_id: taskComposerProjectId.trim() || null,
        due_date: dueDate,
        priority: taskComposerPriority,
        status: 'todo',
        task_horizon: taskComposerHorizon,
        show_in_today: taskComposerHorizon === 'today',
        is_today_focus: false,
        assigned_team_id: assignWorkTeam.id,
        assigned_to_team_id: assignWorkTeam.id,
      });
      await reloadTeams(assignWorkTeam.id);
      setAssignWorkSuccess(`Assigned to ${assignWorkTeam.name}.`);
      setAssignWorkError(null);
      setTaskComposerTitle('');
      setTaskComposerProjectId('');
      setTaskComposerDueDate('');
      setTaskComposerPriority('medium');
      setTaskComposerHorizon('long_term');
    } catch (error) {
      setAssignWorkError(error instanceof Error ? error.message : 'Could not create task.');
    }
  };

  const assignMilestone = async (event: FormEvent) => {
    event.preventDefault();
    if (!assignWorkTeam) return;

    const title = milestoneComposerTitle.trim();
    const projectId = milestoneComposerProjectId.trim();
    const milestoneDate = milestoneComposerDate.trim();
    if (!title || !projectId || !milestoneDate) return;

    try {
      await api.createProjectMilestone(projectId, {
        title,
        milestone_date: milestoneDate,
        type: milestoneComposerType.trim() || 'Custom',
        assigned_team_id: assignWorkTeam.id,
        assigned_to_team_id: assignWorkTeam.id,
      });
      await reloadTeams(assignWorkTeam.id);
      setAssignWorkSuccess(`Assigned to ${assignWorkTeam.name}.`);
      setAssignWorkError(null);
      setMilestoneComposerTitle('');
      setMilestoneComposerProjectId('');
      setMilestoneComposerDate('');
      setMilestoneComposerType('Custom');
    } catch (error) {
      setAssignWorkError(error instanceof Error ? error.message : 'Could not create milestone.');
    }
  };

  const resetAssignWorkComposer = () => {
    setAssignWorkSuccess(null);
    setAssignWorkError(null);
    setAssignWorkMode('search');
    setAssignWorkSearch('');
    setTaskComposerTitle('');
    setTaskComposerProjectId('');
    setTaskComposerDueDate('');
    setTaskComposerPriority('medium');
    setTaskComposerHorizon('long_term');
    setMilestoneComposerTitle('');
    setMilestoneComposerProjectId('');
    setMilestoneComposerDate('');
    setMilestoneComposerType('Custom');
  };

  const openProjectLinkModal = () => {
    if (!openedTeam) return;
    setProjectLinkSearch('');
    setProjectLinkNameDraft('');
    setIsProjectLinkOpen(true);
  };

  const openNoteLinkModal = () => {
    if (!openedTeam) return;
    setNoteLinkSearch('');
    setNoteLinkTitleDraft('');
    setIsNoteLinkOpen(true);
  };

  const copyLedgerLink = async (kind: string, sourceId: string) => {
    try {
      await navigator.clipboard.writeText(`ledger://${kind}/${sourceId}`);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  };

  const openNoteById = (noteId: string) => {
    void window.desktopWindow?.toggleModule('notes', { focusNoteId: noteId });
  };

  const openProjectById = (projectId: string) => {
    void window.desktopWindow?.toggleModule('projects', { focusProjectId: projectId });
  };

  const openTaskById = (taskId: string) => {
    void window.desktopWindow?.toggleModule('projects', { focusTaskId: taskId });
  };

  const openMemberInCircle = (memberId: string, memberName?: string | null) => {
    void window.desktopWindow?.toggleModule(
      'circle' as any,
      {
        kind: 'circle' as any,
        focusContext: `ledger-person|${memberId}|${encodeURIComponent(memberName ?? 'Member')}`,
      } as any
    );
  };

  const openPersonTaskComposer = (memberId: string, memberName?: string | null) => {
    void window.desktopWindow?.toggleModule(
      'quick-task' as any,
      {
        kind: 'quick-task' as any,
        focusContext: `ledger-person|${memberId}|${encodeURIComponent(memberName ?? 'Member')}`,
      } as any
    );
  };

  const openPersonFollowUpComposer = (memberId: string, memberName?: string | null) => {
    void window.desktopWindow?.toggleModule(
      'quick-follow-up' as any,
      {
        kind: 'quick-follow-up' as any,
        focusContext: `ledger-person|${memberId}|${encodeURIComponent(memberName ?? 'Member')}`,
      } as any
    );
  };

  const closeTeamRowContextMenu = () => setTeamRowContextMenu(null);

  const openTeamRowContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    menu: TeamRowContextMenuState
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setTeamRowContextMenu(menu);
  };

  const refreshOpenedTeam = async () => {
    if (!openedTeamId) return;
    await reloadTeams(openedTeamId);
  };

  const canManageOpenedTeam =
    activeWorkspace?.role === 'owner' ||
    activeWorkspace?.role === 'admin' ||
    openedTeam?.currentUserRole === 'lead';

  const unpinTeamNote = async (noteId: string) => {
    if (!openedTeam) return;
    try {
      await api.unlinkTeamNote(openedTeam.id, noteId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const pinTeamNote = async (noteId: string) => {
    if (!openedTeam) return;
    try {
      await api.linkTeamNote(openedTeam.id, noteId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const unpinTeamProject = async (projectId: string) => {
    if (!openedTeam) return;
    try {
      await api.updateProject(projectId, { owner_team_id: null });
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const updateTeamProjectStatus = async (
    projectId: string,
    status: 'not_started' | 'in_progress' | 'paused' | 'completed'
  ) => {
    try {
      const payload: Record<string, unknown> = {
        status:
          status === 'not_started'
            ? 'not_started'
            : status === 'in_progress'
            ? 'in_progress'
            : status === 'paused'
            ? 'paused'
            : 'completed',
      };
      if (status === 'completed') {
        payload.completeness = 100;
      }
      await api.updateProject(projectId, payload);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const deleteTeamProject = async (projectId: string) => {
    try {
      await api.deleteProject(projectId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const updateTeamTaskStatus = async (
    taskId: string,
    status: 'todo' | 'in_progress' | 'completed'
  ) => {
    try {
      await api.updateTask(taskId, { status });
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const deleteTeamTask = async (taskId: string) => {
    try {
      await api.deleteTask(taskId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const toggleTeamMilestoneComplete = async (milestoneId: string, completed: boolean) => {
    try {
      await api.updateProjectMilestone(milestoneId, { completed: !completed });
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const deleteTeamMilestone = async (milestoneId: string) => {
    try {
      await api.deleteProjectMilestone(milestoneId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const acceptTeamIntakeItem = async (item: {
    id: string;
    suggested_type?: string | null;
    title: string;
  }) => {
    const type = ['task', 'note', 'reminder', 'event', 'project'].includes(
      String(item.suggested_type ?? '').toLowerCase()
    )
      ? (String(item.suggested_type).toLowerCase() as
          | 'task'
          | 'note'
          | 'reminder'
          | 'event'
          | 'project')
      : 'task';
    try {
      await api.convertIntakeItem(item.id, { type, title: item.title });
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const markTeamReminderComplete = async (reminderId: string) => {
    try {
      await api.updateReminder(reminderId, { status: 'completed' });
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const snoozeTeamReminder = async (reminderId: string) => {
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + 1);
    try {
      await api.snoozeReminder(reminderId, snoozedUntil.toISOString());
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const deleteTeamReminder = async (reminderId: string) => {
    try {
      await api.deleteReminder(reminderId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const deleteTeamEvent = async (eventId: string) => {
    try {
      await api.deleteEvent(eventId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const duplicateTeamNote = async (noteId: string) => {
    try {
      await api.duplicateNote(noteId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const deleteTeamNote = async (noteId: string) => {
    try {
      await api.deleteNote(noteId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const updateTeamMemberRole = async (memberId: string, role: 'lead' | 'member' | 'viewer') => {
    if (!openedTeam) return;
    try {
      await api.updateTeamMember(openedTeam.id, memberId, { role });
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const removeTeamMemberFromTeam = async (memberId: string) => {
    if (!openedTeam) return;
    try {
      await api.removeTeamMember(openedTeam.id, memberId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const snoozeTeamIntakeItem = async (itemId: string, days = 1) => {
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + days);
    try {
      await api.snoozeIntakeItem(itemId, snoozedUntil.toISOString());
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const archiveTeamIntakeItem = async (itemId: string) => {
    try {
      await api.archiveIntakeItem(itemId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const deleteTeamIntakeItem = async (itemId: string) => {
    try {
      await api.deleteIntakeItem(itemId);
      await refreshOpenedTeam();
    } catch (error) {
      console.error(error);
    } finally {
      closeTeamRowContextMenu();
    }
  };

  const openTeamCalendarItem = (item: {
    id: string;
    type: 'event' | 'reminder' | 'milestone';
    start?: string | null;
  }) => {
    const focusContext =
      item.type === 'event'
        ? `focus-event:${item.id}`
        : item.type === 'reminder'
        ? `focus-reminder:${item.id}`
        : null;
    void window.desktopWindow?.openModule('calendar', {
      focusDate: item.start ? String(item.start).slice(0, 10) : undefined,
      focusContext: focusContext ?? undefined,
    });
  };

  const openTeamActivityItem = (activity: {
    object_type?: string | null;
    object_id?: string | null;
    timestamp?: string | null;
  }) => {
    const kind = String(activity.object_type ?? '').toLowerCase();
    const objectId = String(activity.object_id ?? '').trim();
    if (!objectId) return;
    if (kind === 'project') return openProjectById(objectId);
    if (kind === 'note') return openNoteById(objectId);
    if (kind === 'task') return openTaskById(objectId);
    if (kind === 'event' || kind === 'reminder') {
      openTeamCalendarItem({
        id: objectId,
        type: kind,
        start: activity.timestamp ?? null,
      });
      return;
    }
    if (kind === 'workspace_team_member') {
      const member = teamMembers.find((item) => item.id === objectId);
      if (member) openMemberInCircle(member.id, member.name);
    }
  };

  const linkExistingProject = async (projectId: string) => {
    if (!openedTeam) return;
    try {
      await api.updateProject(projectId, { owner_team_id: openedTeam.id });
      await reloadTeams(openedTeam.id);
      setIsProjectLinkOpen(false);
    } catch (error) {
      setAssignWorkError(error instanceof Error ? error.message : 'Could not add project.');
    }
  };

  const createProjectForTeam = async () => {
    if (!openedTeam) return;
    const name = projectLinkNameDraft.trim();
    if (!name) return;
    try {
      await api.createProject({ name, owner_team_id: openedTeam.id });
      await reloadTeams(openedTeam.id);
      setIsProjectLinkOpen(false);
    } catch (error) {
      setAssignWorkError(error instanceof Error ? error.message : 'Could not create project.');
    }
  };

  const linkExistingNote = async (noteId: string) => {
    if (!openedTeam) return;
    try {
      await api.linkTeamNote(openedTeam.id, noteId);
      await reloadTeams(openedTeam.id);
      setIsNoteLinkOpen(false);
    } catch (error) {
      setAssignWorkError(error instanceof Error ? error.message : 'Could not link note.');
    }
  };

  const createNoteForTeam = async () => {
    if (!openedTeam) return;
    const title = noteLinkTitleDraft.trim();
    if (!title) return;
    try {
      const created = await api.createNote(title, '', { source: 'workspace', mode: 'text' });
      const nextNoteId = (created as { id?: string })?.id;
      if (nextNoteId) {
        await api.linkTeamNote(openedTeam.id, nextNoteId);
      }
      await reloadTeams(openedTeam.id);
      setIsNoteLinkOpen(false);
    } catch (error) {
      setAssignWorkError(error instanceof Error ? error.message : 'Could not create note.');
    }
  };

  const teamRowBaseClass =
    'group grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-3 py-1.5 text-left transition';
  const teamRowHoverClass = 'hover:bg-[var(--ledger-surface-hover)]';
  const teamRowIconClass =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[12px] text-[var(--ledger-text-secondary)]';
  const teamRowTitleClass =
    'min-w-0 truncate text-[13px] font-medium leading-5 text-[var(--ledger-text-primary)]';
  const teamRowMetaClass =
    'shrink-0 truncate text-[11px] leading-4 text-[var(--ledger-text-muted)]';
  const teamSectionActionClass =
    'text-xs font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]';

  const renderTeamSectionShell = (
    sectionId: TeamSectionId,
    title: string,
    action: ReactNode,
    children: ReactNode,
    count?: number
  ) => {
    const collapsed =
      typeof count === 'number' && count === 0 ? true : collapsedTeamSections[sectionId];
    return (
      <section className="min-w-0">
        <div
          role="button"
          tabIndex={0}
          onClick={() =>
            setCollapsedTeamSections((current) => ({
              ...current,
              [sectionId]: !current[sectionId],
            }))
          }
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            setCollapsedTeamSections((current) => ({
              ...current,
              [sectionId]: !current[sectionId],
            }));
          }}
          className="flex h-8 w-full items-center justify-between rounded-lg bg-[var(--ledger-surface-muted)] px-3 text-left transition hover:bg-[var(--ledger-surface-hover)]"
        >
          <div className="flex min-w-0 items-center gap-2">
            <ChevronDown
              size={14}
              className={`shrink-0 text-[var(--ledger-text-muted)] transition ${
                collapsed ? '-rotate-90' : 'rotate-0'
              }`}
            />
            <span className="truncate text-[12px] font-medium text-[var(--ledger-text-secondary)]">
              {title}
            </span>
            {typeof count === 'number' ? (
              <span className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--ledger-text-muted)]">
                {count}
              </span>
            ) : null}
          </div>
          <div
            className="flex items-center gap-2"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {action}
          </div>
        </div>
        {!collapsed ? <div className="pt-1">{children}</div> : null}
      </section>
    );
  };

  const renderRightPanel = () => {
    if (!currentTeam) return null;

    return (
      <aside className={teamsTheme.rightPanel}>
        <div className="space-y-2">
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-[var(--ledger-text-muted)]">Members</span>
            <div className="flex justify-start">
              <AvatarStack
                members={teamMembers}
                maxVisible={3}
                onMemberContextMenu={(member, event) =>
                  openTeamRowContextMenu(event, {
                    kind: 'member',
                    memberId: member.id,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-[var(--ledger-text-muted)]">Go to</span>
          </div>
          <div className="space-y-1">
            {[
              {
                label: 'Tasks',
                icon: <ListTodo size={13} />,
                action: () =>
                  void window.desktopWindow?.toggleModule('inbox', {
                    focusContext: `team:${currentTeam.id}`,
                  }),
                count: teamQuickLinkCounts.get('tasks'),
              },
              {
                label: 'Projects',
                icon: <Sparkles size={13} />,
                action: () =>
                  void window.desktopWindow?.toggleModule('projects', {
                    focusContext: `team:${currentTeam.id}`,
                  }),
                count: teamQuickLinkCounts.get('projects'),
              },
              {
                label: 'Notes',
                icon: <FileText size={13} />,
                action: () => void window.desktopWindow?.toggleModule('notes'),
                count: teamQuickLinkCounts.get('notes'),
              },
              {
                label: 'Calendar',
                icon: <CalendarDays size={13} />,
                action: () => void window.desktopWindow?.openModule('calendar'),
                count: teamQuickLinkCounts.get('calendar'),
              },
              {
                label: 'Intake',
                icon: <Inbox size={13} />,
                action: () =>
                  void window.desktopWindow?.toggleModule('inbox', {
                    focusContext: `team:${currentTeam.id}`,
                  }),
                count: teamQuickLinkCounts.get('intake'),
              },
              {
                label: 'Team settings',
                icon: <Link2 size={13} />,
                action: () =>
                  void window.desktopWindow?.openModule('teams', {
                    focusContext: `team-settings:${currentTeam.id}`,
                  } as any),
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-[var(--ledger-text-muted)]">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.count === 'number' ? (
                  <span className="text-[10px] text-[var(--ledger-text-muted)]">{item.count}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
              Team details
            </span>
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between gap-3 rounded-none px-0 py-0 text-xs">
                <span className="text-[var(--ledger-text-muted)]">Identifier</span>
                <span className="truncate font-mono text-[var(--ledger-text-secondary)]">
                  {teamDisplayIdentifier}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-none px-0 py-0 text-xs">
                <span className="text-[var(--ledger-text-muted)]">Workspace</span>
                <span className="truncate text-[var(--ledger-text-secondary)]">
                  {workspaceName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-none px-0 py-0 text-xs">
                <span className="text-[var(--ledger-text-muted)]">Created</span>
                <span className="text-[var(--ledger-text-secondary)]">
                  {formatShortDate(teamOverview?.team.created_at ?? null) ?? 'Unknown'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-none px-0 py-0 text-xs">
                <span className="text-[var(--ledger-text-muted)]">Updated</span>
                <span className="text-[var(--ledger-text-secondary)]">
                  {formatShortDate(teamOverview?.team.updated_at ?? null) ?? 'Unknown'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    );
  };

  const renderTeamRowContextMenu = () => {
    if (!teamRowContextMenu) return null;

    const menuClasses = `${sidebarTheme.menu} z-[9999] w-64 overflow-hidden`;
    const menuItemClass = `${sidebarTheme.menuItem} disabled:cursor-not-allowed disabled:opacity-40`;
    const menuDangerClass = `${sidebarTheme.menuItemDanger} disabled:cursor-not-allowed disabled:opacity-40`;
    const menuWidth =
      teamRowContextMenu.kind === 'member'
        ? 248
        : teamRowContextMenu.kind === 'activity'
        ? 228
        : teamRowContextMenu.kind === 'upcoming'
        ? 260
        : 256;
    const menuHeight =
      teamRowContextMenu.kind === 'member'
        ? 280
        : teamRowContextMenu.kind === 'activity'
        ? 180
        : teamRowContextMenu.kind === 'upcoming'
        ? 268
        : 248;
    const menuStyle = {
      left: Math.max(8, Math.min(teamRowContextMenu.x + 8, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(teamRowContextMenu.y + 8, window.innerHeight - menuHeight - 8)),
    };

    const copyCurrentItemLink = async (kind: string, id: string) => {
      await copyLedgerLink(kind, id);
      closeTeamRowContextMenu();
    };

    const renderDivider = (key: string) => (
      <div key={key} className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
    );

    switch (teamRowContextMenu.kind) {
      case 'resource': {
        if (teamRowContextMenu.resourceKind === 'project') {
          return (
            <div
              className={menuClasses}
              style={menuStyle}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  openProjectById(teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Open project
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyCurrentItemLink('project', teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Copy project link
              </button>
              {canManageOpenedTeam ? (
                <>
                  {renderDivider('project-divider')}
                  <button
                    type="button"
                    onClick={() => {
                      void unpinTeamProject(teamRowContextMenu.resourceId);
                    }}
                    className={menuDangerClass}
                  >
                    Unpin from team
                  </button>
                </>
              ) : null}
            </div>
          );
        }

        if (teamRowContextMenu.resourceKind === 'note') {
          const note = teamNoteById.get(teamRowContextMenu.resourceId);
          const linkedProjectId =
            note?.project_id ?? note?.projectId ?? note?.linked_project?.id ?? null;
          const isPinned = teamLinkedNoteIds.has(teamRowContextMenu.resourceId);
          return (
            <div
              className={menuClasses}
              style={menuStyle}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  openNoteById(teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Open note
              </button>
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  openNoteById(teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Open in Notes
              </button>
              {linkedProjectId ? (
                <button
                  type="button"
                  onClick={() => {
                    closeTeamRowContextMenu();
                    openProjectById(linkedProjectId);
                  }}
                  className={menuItemClass}
                >
                  Open linked project
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void copyCurrentItemLink('note', teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Copy note link
              </button>
              <button
                type="button"
                onClick={() => {
                  void duplicateTeamNote(teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Duplicate
              </button>
              {canManageOpenedTeam ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void (isPinned
                        ? unpinTeamNote(teamRowContextMenu.resourceId)
                        : pinTeamNote(teamRowContextMenu.resourceId));
                    }}
                    className={menuItemClass}
                  >
                    {isPinned ? 'Unpin from team' : 'Pin to team'}
                  </button>
                  {renderDivider('note-divider')}
                  <button
                    type="button"
                    onClick={() => {
                      void deleteTeamNote(teamRowContextMenu.resourceId);
                    }}
                    className={menuDangerClass}
                  >
                    Delete
                  </button>
                </>
              ) : null}
            </div>
          );
        }

        if (teamRowContextMenu.resourceKind === 'task') {
          const task = teamTaskById.get(teamRowContextMenu.resourceId);
          const isComplete = String(task?.status ?? '').toLowerCase() === 'completed';
          const linkedProjectId = task?.project?.id ?? task?.project_id ?? null;
          return (
            <div
              className={menuClasses}
              style={menuStyle}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  openTaskById(teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Open task
              </button>
              <button
                type="button"
                onClick={() => {
                  void updateTeamTaskStatus(
                    teamRowContextMenu.resourceId,
                    isComplete ? 'todo' : 'completed'
                  );
                }}
                className={menuItemClass}
              >
                {isComplete ? 'Reopen' : 'Mark complete'}
              </button>
              {linkedProjectId ? (
                <button
                  type="button"
                  onClick={() => {
                    closeTeamRowContextMenu();
                    openProjectById(linkedProjectId);
                  }}
                  className={menuItemClass}
                >
                  Open project
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void copyCurrentItemLink('task', teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Copy task link
              </button>
              <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  void deleteTeamTask(teamRowContextMenu.resourceId);
                }}
                className={menuDangerClass}
              >
                Delete
              </button>
            </div>
          );
        }

        if (teamRowContextMenu.resourceKind === 'event') {
          return (
            <div
              className={menuClasses}
              style={menuStyle}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  void openTeamCalendarItem({
                    id: teamRowContextMenu.resourceId,
                    type: 'event',
                    start: null,
                  });
                }}
                className={menuItemClass}
              >
                Open event
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyCurrentItemLink('event', teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Copy link
              </button>
              <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  void deleteTeamEvent(teamRowContextMenu.resourceId);
                }}
                className={menuDangerClass}
              >
                Delete
              </button>
            </div>
          );
        }

        if (teamRowContextMenu.resourceKind === 'external') {
          return (
            <div
              className={menuClasses}
              style={menuStyle}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  void window.desktopWindow?.openExternal(teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Open link
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyCurrentItemLink('external', teamRowContextMenu.resourceId);
                }}
                className={menuItemClass}
              >
                Copy link
              </button>
            </div>
          );
        }

        return null;
      }
      case 'note': {
        const note = teamNoteById.get(teamRowContextMenu.noteId);
        const linkedProjectId =
          note?.project_id ?? note?.projectId ?? note?.linked_project?.id ?? null;
        const isPinned = teamLinkedNoteIds.has(teamRowContextMenu.noteId);
        return (
          <div
            className={menuClasses}
            style={menuStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                openNoteById(teamRowContextMenu.noteId);
              }}
              className={menuItemClass}
            >
              Open note
            </button>
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                openNoteById(teamRowContextMenu.noteId);
              }}
              className={menuItemClass}
            >
              Open in Notes
            </button>
            {linkedProjectId ? (
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  openProjectById(linkedProjectId);
                }}
                className={menuItemClass}
              >
                Open linked project
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void copyCurrentItemLink('note', teamRowContextMenu.noteId);
              }}
              className={menuItemClass}
            >
              Copy note link
            </button>
            <button
              type="button"
              onClick={() => {
                void duplicateTeamNote(teamRowContextMenu.noteId);
              }}
              className={menuItemClass}
            >
              Duplicate
            </button>
            {canManageOpenedTeam ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void (isPinned
                      ? unpinTeamNote(teamRowContextMenu.noteId)
                      : pinTeamNote(teamRowContextMenu.noteId));
                  }}
                  className={menuItemClass}
                >
                  {isPinned ? 'Unpin from team' : 'Pin to team'}
                </button>
                {renderDivider('note-divider-2')}
                <button
                  type="button"
                  onClick={() => {
                    void deleteTeamNote(teamRowContextMenu.noteId);
                  }}
                  className={menuDangerClass}
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        );
      }
      case 'task': {
        const task = teamTaskById.get(teamRowContextMenu.taskId);
        const isComplete = String(task?.status ?? '').toLowerCase() === 'completed';
        const linkedProjectId = task?.project?.id ?? task?.project_id ?? null;
        return (
          <div
            className={menuClasses}
            style={menuStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                openTaskById(teamRowContextMenu.taskId);
              }}
              className={menuItemClass}
            >
              Open task
            </button>
            <button
              type="button"
              onClick={() => {
                void updateTeamTaskStatus(
                  teamRowContextMenu.taskId,
                  isComplete ? 'todo' : 'completed'
                );
              }}
              className={menuItemClass}
            >
              {isComplete ? 'Reopen' : 'Mark complete'}
            </button>
            {linkedProjectId ? (
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  openProjectById(linkedProjectId);
                }}
                className={menuItemClass}
              >
                Open project
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void copyCurrentItemLink('task', teamRowContextMenu.taskId);
              }}
              className={menuItemClass}
            >
              Copy task link
            </button>
            {canManageOpenedTeam ? (
              <>
                {renderDivider('task-divider')}
                <button
                  type="button"
                  onClick={() => {
                    void deleteTeamTask(teamRowContextMenu.taskId);
                  }}
                  className={menuDangerClass}
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        );
      }
      case 'project': {
        const project = teamProjectById.get(teamRowContextMenu.projectId);
        return (
          <div
            className={menuClasses}
            style={menuStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                openProjectById(teamRowContextMenu.projectId);
              }}
              className={menuItemClass}
            >
              Open project
            </button>
            <button
              type="button"
              onClick={() => {
                void copyCurrentItemLink('project', teamRowContextMenu.projectId);
              }}
              className={menuItemClass}
            >
              Copy project link
            </button>
            <button
              type="button"
              onClick={() => {
                void updateTeamProjectStatus(
                  teamRowContextMenu.projectId,
                  project?.status && String(project.status).toLowerCase().includes('complete')
                    ? 'in_progress'
                    : 'completed'
                );
              }}
              className={menuItemClass}
            >
              {project?.status && String(project.status).toLowerCase().includes('complete')
                ? 'Reopen'
                : 'Mark complete'}
            </button>
            {canManageOpenedTeam ? (
              <>
                {renderDivider('project-divider-2')}
                <button
                  type="button"
                  onClick={() => {
                    void deleteTeamProject(teamRowContextMenu.projectId);
                  }}
                  className={menuDangerClass}
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        );
      }
      case 'upcoming': {
        const item = teamUpcomingById.get(teamRowContextMenu.itemId);
        if (!item) return null;
        return (
          <div
            className={menuClasses}
            style={menuStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                openTeamCalendarItem(item);
              }}
              className={menuItemClass}
            >
              Open {item.type}
            </button>
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                window.desktopWindow?.openModule('calendar');
              }}
              className={menuItemClass}
            >
              Open in Calendar
            </button>
            {item.project?.id ? (
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  openProjectById(item.project?.id ?? '');
                }}
                className={menuItemClass}
              >
                Open project
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void copyCurrentItemLink(item.type, item.id);
              }}
              className={menuItemClass}
            >
              Copy link
            </button>
            {item.type === 'reminder' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void markTeamReminderComplete(item.id);
                  }}
                  className={menuItemClass}
                >
                  Mark complete
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void snoozeTeamReminder(item.id);
                  }}
                  className={menuItemClass}
                >
                  Snooze
                </button>
              </>
            ) : null}
            {item.type === 'milestone' ? (
              <button
                type="button"
                onClick={() => {
                  void toggleTeamMilestoneComplete(
                    item.id,
                    String(item.status ?? '').toLowerCase() === 'completed'
                  );
                }}
                className={menuItemClass}
              >
                {String(item.status ?? '').toLowerCase() === 'completed'
                  ? 'Reopen milestone'
                  : 'Mark complete'}
              </button>
            ) : null}
            <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
            <button
              type="button"
              onClick={() => {
                if (item.type === 'event') {
                  void deleteTeamEvent(item.id);
                } else if (item.type === 'reminder') {
                  void deleteTeamReminder(item.id);
                } else {
                  void deleteTeamMilestone(item.id);
                }
              }}
              className={menuDangerClass}
            >
              Delete
            </button>
          </div>
        );
      }
      case 'activity': {
        const activity = teamActivityById.get(teamRowContextMenu.activityId);
        if (!activity) return null;
        const actorId = (activity as { actor_id?: string | null }).actor_id ?? null;
        return (
          <div
            className={menuClasses}
            style={menuStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                openTeamActivityItem(activity);
              }}
              className={menuItemClass}
            >
              Open related item
            </button>
            {actorId ? (
              <button
                type="button"
                onClick={() => {
                  closeTeamRowContextMenu();
                  openMemberInCircle(actorId, activity.actor ?? undefined);
                }}
                className={menuItemClass}
              >
                Open actor in Circle
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void copyCurrentItemLink('activity', activity.id);
              }}
              className={menuItemClass}
            >
              Copy link
            </button>
          </div>
        );
      }
      case 'member': {
        const member = teamOverviewMembersById.get(teamRowContextMenu.memberId);
        if (!member) return null;
        const isSelf = member.id === user?.id;
        const isLead = Boolean(
          member.is_lead || member.role === 'lead' || member.team_role === 'lead'
        );
        const canToggleLead = canManageOpenedTeam && !isSelf;
        const canDemoteLead = canToggleLead && isLead && (teamOverview?.team.lead_count ?? 0) > 1;
        const canRemoveMember =
          canManageOpenedTeam && !isSelf && (!isLead || (teamOverview?.team.lead_count ?? 0) > 1);
        return (
          <div
            className={menuClasses}
            style={menuStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                openMemberInCircle(member.id, member.name);
              }}
              className={menuItemClass}
            >
              Open person in Circle
            </button>
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                openPersonTaskComposer(member.id, member.name);
              }}
              className={menuItemClass}
            >
              Assign task
            </button>
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                openPersonFollowUpComposer(member.id, member.name);
              }}
              className={menuItemClass}
            >
              Create follow-up
            </button>
            {member.email ? (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(member.email ?? '')
                    .catch(() => undefined)
                    .finally(() => closeTeamRowContextMenu());
                }}
                className={menuItemClass}
              >
                Copy email
              </button>
            ) : null}
            {canToggleLead ? (
              <>
                <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                {isLead ? (
                  <button
                    type="button"
                    disabled={!canDemoteLead}
                    onClick={() => {
                      void updateTeamMemberRole(member.id, 'member');
                    }}
                    className={menuItemClass}
                  >
                    Remove team lead
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void updateTeamMemberRole(member.id, 'lead');
                    }}
                    className={menuItemClass}
                  >
                    Make team lead
                  </button>
                )}
              </>
            ) : null}
            {canRemoveMember ? (
              <>
                <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
                <button
                  type="button"
                  onClick={() => {
                    void removeTeamMemberFromTeam(member.id);
                  }}
                  className={menuDangerClass}
                >
                  Remove from team
                </button>
              </>
            ) : null}
          </div>
        );
      }
      case 'intake': {
        const item = teamOverview?.needs_attention.intake_items.find(
          (intakeItem) => intakeItem.id === teamRowContextMenu.intakeId
        );
        if (!item) return null;
        return (
          <div
            className={menuClasses}
            style={menuStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                closeTeamRowContextMenu();
                void window.desktopWindow?.toggleModule('inbox');
              }}
              className={menuItemClass}
            >
              Open in Intake
            </button>
            <button
              type="button"
              onClick={() => {
                void acceptTeamIntakeItem({
                  id: item.id,
                  suggested_type: item.suggested_type,
                  title: item.title,
                });
              }}
              className={menuItemClass}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => {
                void snoozeTeamIntakeItem(item.id);
              }}
              className={menuItemClass}
            >
              Snooze
            </button>
            <button
              type="button"
              onClick={() => {
                void archiveTeamIntakeItem(item.id);
              }}
              className={menuItemClass}
            >
              Archive
            </button>
            <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
            <button
              type="button"
              onClick={() => {
                void deleteTeamIntakeItem(item.id);
              }}
              className={menuDangerClass}
            >
              Delete
            </button>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className={teamsTheme.shell} style={workspaceShellLayout.workspaceShellStyle}>
      <ModuleWindowHeader
        title="Teams"
        icon={<Users size={17} />}
        compact
        showBodyHeader={false}
        onClose={() => window.desktopWindow?.closeModule('teams')}
        onMinimize={() => window.desktopWindow?.minimizeModule('teams')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('teams')}
        viewControls={
          openedTeam ? (
            <ModuleHeaderSegmentedGroup compact>
              <ModuleHeaderSegmentedButton
                compact
                title="Return to all teams"
                ariaLabel="Return to all teams"
                onClick={goBackToTeamsList}
                active={false}
              >
                Teams
              </ModuleHeaderSegmentedButton>
            </ModuleHeaderSegmentedGroup>
          ) : undefined
        }
        primaryActions={
          <>
            <ModuleHeaderActionButton
              title="Invite member"
              ariaLabel="Invite member"
              icon={<UserPlus size={14} />}
              onClick={() => openInviteForTeam(openedTeamId ?? selectedTeamId)}
              variant="strip"
            >
              Invite member
            </ModuleHeaderActionButton>
            <ModuleHeaderActionButton
              title="New team"
              ariaLabel="New team"
              icon={<Plus size={14} />}
              onClick={() => setIsNewTeamOpen(true)}
              variant="strip"
            >
              New team
            </ModuleHeaderActionButton>
          </>
        }
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Inbox size={14} />}
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              title="Intake"
              ariaLabel="Open Intake"
            />
            <ModuleHeaderStripAction
              icon={<Bell size={14} />}
              onClick={() =>
                window.dispatchEvent(new CustomEvent('ledger:toggle-notification-tray'))
              }
              notificationTrayToggle
              title="Notifications"
              ariaLabel="Open notifications"
            />
          </>
        }
      />

      <main className={teamsTheme.content}>
        <div className={teamsTheme.page}>
          {!openedTeam ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-[var(--ledger-text-muted)]">
                      Teams
                    </span>
                    <span className="text-xs text-[var(--ledger-text-secondary)]">
                      {filteredTeams.length}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                    <button type="button" className={teamsTheme.action}>
                      <Filter size={13} />
                      Filter
                    </button>
                    <label className="flex h-8 min-w-0 w-full max-w-[280px] items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3">
                      <Search size={13} className="text-[var(--ledger-text-muted)]" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search teams..."
                        className="min-w-0 flex-1 bg-transparent text-xs text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
                      />
                    </label>
                  </div>
                </div>
                <section className={teamsTheme.panel}>
                  <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(170px,1fr)_90px_34px] gap-4 border-b border-[color:var(--ledger-border-subtle)] px-3 py-2 text-[11px] font-medium text-[var(--ledger-text-muted)]">
                    <span>Name</span>
                    <span>Members</span>
                    <span>Identifier</span>
                    <span />
                  </div>
                  <div className="overflow-auto">
                    {filteredTeams.length > 0 ? (
                      filteredTeams.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => setSelectedTeamId(team.id)}
                          onDoubleClick={() => openTeamDetail(team.id)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setSelectedTeamId(team.id);
                            setContextMenu({
                              teamId: team.id,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          className={`${teamsTheme.row} ${
                            selectedTeamId === team.id ? teamsTheme.rowSelected : ''
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <TeamBadge team={team} />
                            <span className="min-w-0">
                              <span className={teamsTheme.title}>{team.name}</span>
                              {team.description ? (
                                <span className="mt-0.5 block truncate text-[11px] text-[var(--ledger-text-muted)]">
                                  {team.description}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {team.currentUserRole ? (
                              <span className={teamsTheme.chip}>
                                <Check size={11} className="mr-1" />
                                {team.currentUserRole === 'lead' ? 'Lead' : 'Joined'}
                              </span>
                            ) : null}
                            <span className={teamsTheme.meta}>{team.members.length} members</span>
                            <span className={teamsTheme.meta}>· {team.assignedCount} assigned</span>
                          </span>
                          <span className="font-mono text-xs font-semibold text-[var(--ledger-text-muted)]">
                            {team.identifier}
                          </span>
                          <span
                            className="flex h-7 w-7 items-center justify-center rounded-lg opacity-0 transition group-hover:opacity-100 hover:bg-[var(--ledger-surface-muted)]"
                            onClick={(event) => {
                              event.stopPropagation();
                              setContextMenu({
                                teamId: team.id,
                                x: event.clientX,
                                y: event.clientY,
                              });
                            }}
                          >
                            <MoreHorizontal size={14} className="text-[var(--ledger-text-muted)]" />
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="flex min-h-[240px] items-center justify-center px-4 py-8">
                        <div className="w-full max-w-sm rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-5 py-4 text-center shadow-sm">
                          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
                            <Users size={15} />
                          </div>
                          <p className="mt-3 text-sm font-medium text-[var(--ledger-text-primary)]">
                            No teams yet
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--ledger-text-muted)]">
                            Create teams to group people and assign work inside this workspace.
                          </p>
                          <div className="mt-3 flex justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => setIsNewTeamOpen(true)}
                              className={teamsTheme.primaryAction}
                            >
                              Create team
                            </button>
                            <button
                              type="button"
                              onClick={() => openInviteForTeam(null)}
                              className={teamsTheme.action}
                            >
                              Invite member
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <section className="space-y-4">
              <div className="min-w-0 space-y-4">
                <header className="flex items-center justify-between gap-3 px-1">
                  <div className="flex min-w-0 items-center gap-3">
                    <TeamBadge team={openedTeam} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h1 className="truncate text-[20px] font-semibold leading-tight text-[var(--ledger-text-primary)]">
                          {teamDisplayName}
                        </h1>
                        <PinActionButton
                          objectType="team"
                          objectId={openedTeam.id}
                          showLabel={false}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                          iconSize={12}
                        />
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setContextMenu({
                              teamId: openedTeam.id,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                          title="Team actions"
                          aria-label="Team actions"
                        >
                          <MoreHorizontal size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(`${window.location.origin}/teams/${openedTeam.id}`)
                        .catch(() => undefined)
                    }
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                    title="Copy team link"
                    aria-label="Copy team link"
                  >
                    <Link2 size={13} />
                  </button>
                </header>
                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <div className="flex min-w-0 gap-1 overflow-x-auto">
                      {tabs.map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setActiveTab(tab)}
                          className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs font-medium transition ${
                            activeTab === tab
                              ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                              : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]'
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>
                    {activeTab === 'Notes' ? (
                      <label className="flex h-8 min-w-0 w-[min(100%,320px)] items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3">
                        <Search size={13} className="text-[var(--ledger-text-muted)]" />
                        <input
                          value={teamNotesQuery}
                          onChange={(event) => setTeamNotesQuery(event.target.value)}
                          placeholder="Search notes..."
                          className="min-w-0 flex-1 bg-transparent text-xs text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
                        />
                      </label>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setResourceMenu({ x: rect.right, y: rect.bottom + 8 });
                    }}
                    className="inline-flex h-8 items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
                  >
                    <Plus size={13} />
                    Add resources
                  </button>
                </div>
                {teamOverviewLoading ? (
                  <p className="px-1 text-xs text-[var(--ledger-text-muted)]">
                    Loading team overview...
                  </p>
                ) : null}
                {teamOverviewError ? (
                  <p className="px-1 text-xs text-[color:#B42318]">{teamOverviewError}</p>
                ) : null}
              </div>
              <section className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="min-w-0 space-y-4">
                  {activeTab === 'Overview' ? (
                    <>
                      {renderTeamSectionShell(
                        'pinnedResources',
                        'Pinned resources',
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setResourceMenu({
                              x: event.currentTarget.getBoundingClientRect().right,
                              y: event.currentTarget.getBoundingClientRect().bottom + 8,
                            });
                          }}
                          className={teamSectionActionClass}
                        >
                          Add resource
                        </button>,
                        teamPinnedResources.length > 0 ? (
                          <div className="space-y-1">
                            {teamPinnedResources.map((resource) => (
                              <button
                                key={resource.id}
                                type="button"
                                onClick={resource.onClick}
                                onContextMenu={(event) =>
                                  openTeamRowContextMenu(event, {
                                    kind: 'resource',
                                    resourceKind: resource.kind,
                                    resourceId: resource.id.replace(/^(project|note)-/, ''),
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                }
                                className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                              >
                                <span className={teamRowIconClass}>
                                  {resource.kind === 'project' ? (
                                    <Sparkles size={12} />
                                  ) : (
                                    <FileText size={12} />
                                  )}
                                </span>
                                <span className="min-w-0">
                                  <span className={teamRowTitleClass}>{resource.title}</span>
                                </span>
                                <span className={teamRowMetaClass}>{resource.meta}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            No pinned resources yet.{' '}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setResourceMenu({
                                  x: event.currentTarget.getBoundingClientRect().right,
                                  y: event.currentTarget.getBoundingClientRect().bottom + 8,
                                });
                              }}
                              className="font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                            >
                              Add resource
                            </button>
                          </div>
                        ),
                        teamPinnedResources.length
                      )}

                      {renderTeamSectionShell(
                        'teamNotes',
                        'Team notes',
                        <button
                          type="button"
                          onClick={openNoteLinkModal}
                          className={teamSectionActionClass}
                        >
                          Link note
                        </button>,
                        teamOverviewNotes.length > 0 ? (
                          <div className="space-y-1">
                            {teamOverviewNotes.slice(0, 5).map((note) => (
                              <button
                                key={note.id}
                                type="button"
                                onClick={() =>
                                  void window.desktopWindow?.toggleModule('notes', {
                                    focusNoteId: note.id,
                                  })
                                }
                                onContextMenu={(event) =>
                                  openTeamRowContextMenu(event, {
                                    kind: 'note',
                                    noteId: note.id,
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                }
                                className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                              >
                                <span className={teamRowIconClass}>
                                  <FileText size={12} />
                                </span>
                                <span className="min-w-0">
                                  <span className={teamRowTitleClass}>{note.title}</span>
                                </span>
                                <span className={teamRowMetaClass}>
                                  {note.projectName
                                    ? `${note.projectName} · project note`
                                    : note.updatedAt
                                    ? `Updated ${formatShortDate(note.updatedAt)}`
                                    : 'Linked note'}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            No team notes yet.{' '}
                            <button
                              type="button"
                              onClick={openNoteLinkModal}
                              className="font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                            >
                              Link note
                            </button>
                          </div>
                        ),
                        teamOverviewNotes.length
                      )}

                      {renderTeamSectionShell(
                        'needsAttention',
                        'Needs attention',
                        <button
                          type="button"
                          onClick={openAssignWorkToCurrentTeam}
                          className={teamSectionActionClass}
                        >
                          Assign work
                        </button>,
                        teamNeedAttentionItems.length > 0 ? (
                          <div className="space-y-1">
                            {teamNeedAttentionItems.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={item.onClick}
                                onContextMenu={(event) =>
                                  openTeamRowContextMenu(event, {
                                    kind:
                                      item.kind === 'task'
                                        ? 'task'
                                        : item.kind === 'milestone'
                                        ? 'upcoming'
                                        : 'intake',
                                    taskId:
                                      item.kind === 'task'
                                        ? item.id.replace(/^task-/, '')
                                        : undefined,
                                    itemId:
                                      item.kind === 'milestone'
                                        ? item.id.replace(/^milestone-/, '')
                                        : undefined,
                                    itemType: item.kind === 'milestone' ? 'milestone' : undefined,
                                    intakeId:
                                      item.kind === 'intake'
                                        ? item.id.replace(/^intake-/, '')
                                        : undefined,
                                    x: event.clientX,
                                    y: event.clientY,
                                  } as TeamRowContextMenuState)
                                }
                                className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                              >
                                <span className={teamRowIconClass}>{item.icon}</span>
                                <span className="min-w-0">
                                  <span className={teamRowTitleClass}>{item.title}</span>
                                </span>
                                <span className={teamRowMetaClass}>
                                  <span className="inline-flex min-w-0 items-center gap-1.5">
                                    <span className="truncate">{item.meta || 'Needs review'}</span>
                                    {item.right ? (
                                      <>
                                        <span>·</span>
                                        <span className="truncate">{item.right}</span>
                                      </>
                                    ) : null}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            Nothing needs attention.
                          </div>
                        ),
                        teamNeedAttentionItems.length
                      )}

                      {renderTeamSectionShell(
                        'activeProjects',
                        'Active projects',
                        <button
                          type="button"
                          onClick={openProjectLinkModal}
                          className={teamSectionActionClass}
                        >
                          Add project
                        </button>,
                        teamActiveProjects.length > 0 ? (
                          <div className="space-y-1">
                            {teamActiveProjects.slice(0, 6).map((project) => (
                              <button
                                key={project.id}
                                type="button"
                                onClick={() =>
                                  void window.desktopWindow?.toggleModule('projects', {
                                    focusProjectId: project.id,
                                  })
                                }
                                onContextMenu={(event) =>
                                  openTeamRowContextMenu(event, {
                                    kind: 'project',
                                    projectId: project.id,
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                }
                                className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                              >
                                <span className={teamRowIconClass}>
                                  <Sparkles size={12} />
                                </span>
                                <span className="min-w-0">
                                  <span className={teamRowTitleClass}>{project.title}</span>
                                </span>
                                <span className="flex items-center gap-2">
                                  <span className={teamRowMetaClass}>
                                    {[
                                      formatProjectStatusLabel(project.status),
                                      project.lead
                                        ? teamMemberLabelById.get(project.lead) ?? null
                                        : null,
                                      project.due_date ? formatShortDate(project.due_date) : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </span>
                                  {typeof project.progress === 'number' ? (
                                    <span className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-[var(--ledger-text-muted)]">
                                        {project.progress}%
                                      </span>
                                      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--ledger-surface-muted)]">
                                        <span
                                          className="block h-full rounded-full bg-[var(--ledger-accent)]"
                                          style={{
                                            width: `${Math.max(
                                              4,
                                              Math.min(100, project.progress)
                                            )}%`,
                                          }}
                                        />
                                      </span>
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            No active projects.
                          </div>
                        ),
                        teamActiveProjects.length
                      )}

                      {renderTeamSectionShell(
                        'upcoming',
                        'Upcoming',
                        <button
                          type="button"
                          onClick={() => void window.desktopWindow?.openModule('calendar')}
                          className={teamSectionActionClass}
                        >
                          Calendar
                        </button>,
                        teamUpcomingItems.length > 0 ? (
                          <div className="space-y-1">
                            {teamUpcomingItems.slice(0, 6).map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => void window.desktopWindow?.openModule('calendar')}
                                onContextMenu={(event) =>
                                  openTeamRowContextMenu(event, {
                                    kind: 'upcoming',
                                    itemId: item.id,
                                    itemType: item.type,
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                }
                                className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                              >
                                <span className={teamRowIconClass}>
                                  <CalendarDays size={12} />
                                </span>
                                <span className="min-w-0">
                                  <span className={teamRowTitleClass}>{item.title}</span>
                                </span>
                                <span className={teamRowMetaClass}>
                                  {[
                                    item.type === 'event'
                                      ? 'Event'
                                      : item.type === 'reminder'
                                      ? 'Reminder'
                                      : 'Milestone',
                                    item.start
                                      ? formatShortDate(item.start)
                                      : item.project?.name ?? null,
                                    item.end ? formatShortDate(item.end) : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            Nothing upcoming.
                          </div>
                        ),
                        teamUpcomingItems.length
                      )}

                      {renderTeamSectionShell(
                        'recentActivity',
                        'Recent activity',
                        <button
                          type="button"
                          onClick={() => setActiveTab('Notes')}
                          className={teamSectionActionClass}
                        >
                          Notes
                        </button>,
                        teamRecentActivity.length > 0 ? (
                          <div className="space-y-1">
                            {teamRecentActivity.slice(0, 6).map((item) => (
                              <div
                                key={item.id}
                                className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                                onContextMenu={(event) =>
                                  openTeamRowContextMenu(event, {
                                    kind: 'activity',
                                    activityId: item.id,
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                }
                              >
                                <span className={teamRowIconClass}>
                                  <Users size={12} />
                                </span>
                                <span className="min-w-0">
                                  <span className={teamRowTitleClass}>
                                    {(item.actor ? `${item.actor} ` : '') +
                                      item.action +
                                      (item.object_title ? ` ${item.object_title}` : '')}
                                  </span>
                                </span>
                                <span className={teamRowMetaClass}>
                                  {formatRelativeTime(item.timestamp)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            No recent activity.
                          </div>
                        ),
                        teamRecentActivity.length
                      )}
                    </>
                  ) : activeTab === 'Notes' ? (
                    <div className="space-y-4">
                      {teamNotesQuery.trim() ? (
                        <div className="px-1">
                          <button
                            type="button"
                            onClick={() => setTeamNotesQuery('')}
                            className={teamsTheme.action}
                          >
                            Clear
                          </button>
                        </div>
                      ) : null}
                      {teamNotesLoading ? (
                        <p className="px-1 text-xs text-[var(--ledger-text-muted)]">
                          Loading notes...
                        </p>
                      ) : null}
                      {renderTeamSectionShell(
                        'teamNotes',
                        'Meeting notes',
                        null,
                        teamNotes.filter((note) =>
                          /meeting|sync|standup|review|planning/i.test(note.title)
                        ).length > 0 ? (
                          <div className="space-y-1">
                            {teamNotes
                              .filter((note) =>
                                /meeting|sync|standup|review|planning/i.test(note.title)
                              )
                              .slice(0, 5)
                              .map((note) => (
                                <button
                                  key={note.id}
                                  type="button"
                                  onClick={() =>
                                    void window.desktopWindow?.toggleModule('notes', {
                                      focusNoteId: note.id,
                                    })
                                  }
                                  onContextMenu={(event) =>
                                    openTeamRowContextMenu(event, {
                                      kind: 'note',
                                      noteId: note.id,
                                      x: event.clientX,
                                      y: event.clientY,
                                    })
                                  }
                                  className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                                >
                                  <span className={teamRowIconClass}>
                                    <FileText size={12} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className={teamRowTitleClass}>{note.title}</span>
                                  </span>
                                  <span className={teamRowMetaClass}>
                                    {note.updatedAt
                                      ? `Updated ${formatShortDate(note.updatedAt)}`
                                      : 'Meeting note'}
                                  </span>
                                </button>
                              ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            No meeting notes yet.
                          </div>
                        ),
                        teamNotes.filter((note) =>
                          /meeting|sync|standup|review|planning/i.test(note.title)
                        ).length
                      )}
                      {renderTeamSectionShell(
                        'pinnedResources',
                        'Shared references',
                        null,
                        teamNotes.filter((note) => Boolean(note.projectName)).length > 0 ? (
                          <div className="space-y-1">
                            {teamNotes
                              .filter((note) => Boolean(note.projectName))
                              .slice(0, 5)
                              .map((note) => (
                                <button
                                  key={note.id}
                                  type="button"
                                  onClick={() =>
                                    void window.desktopWindow?.toggleModule('notes', {
                                      focusNoteId: note.id,
                                    })
                                  }
                                  onContextMenu={(event) =>
                                    openTeamRowContextMenu(event, {
                                      kind: 'note',
                                      noteId: note.id,
                                      x: event.clientX,
                                      y: event.clientY,
                                    })
                                  }
                                  className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                                >
                                  <span className={teamRowIconClass}>
                                    <Link2 size={12} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className={teamRowTitleClass}>{note.title}</span>
                                  </span>
                                  <span className={teamRowMetaClass}>
                                    {note.projectName ?? 'Shared reference'}
                                  </span>
                                </button>
                              ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            No shared references yet.
                          </div>
                        ),
                        teamNotes.filter((note) => Boolean(note.projectName)).length
                      )}
                      {renderTeamSectionShell(
                        'recentActivity',
                        'Recent notes',
                        null,
                        teamNotes.length > 0 ? (
                          <div className="space-y-1">
                            {teamNotes.slice(0, 8).map((note) => (
                              <button
                                key={note.id}
                                type="button"
                                onClick={() =>
                                  void window.desktopWindow?.toggleModule('notes', {
                                    focusNoteId: note.id,
                                  })
                                }
                                onContextMenu={(event) =>
                                  openTeamRowContextMenu(event, {
                                    kind: 'note',
                                    noteId: note.id,
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                }
                                className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                              >
                                <span className={teamRowIconClass}>
                                  <FileText size={12} />
                                </span>
                                <span className="min-w-0">
                                  <span className={teamRowTitleClass}>{note.title}</span>
                                </span>
                                <span className={teamRowMetaClass}>
                                  {note.updatedAt
                                    ? `Updated ${formatShortDate(note.updatedAt)}`
                                    : 'Recent note'}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            No team notes yet.
                          </div>
                        ),
                        teamNotes.length
                      )}
                    </div>
                  ) : activeTab === 'Members' ? (
                    <div className="space-y-4">
                      {renderTeamSectionShell(
                        'activeProjects',
                        'Members',
                        <button
                          type="button"
                          onClick={() => setAddMemberTeamId(openedTeam.id)}
                          className={teamSectionActionClass}
                        >
                          Add member
                        </button>,
                        teamMembers.length > 0 ? (
                          <div className="space-y-1">
                            {teamMembers.map((member) => (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => setAddMemberTeamId(openedTeam.id)}
                                onContextMenu={(event) =>
                                  openTeamRowContextMenu(event, {
                                    kind: 'member',
                                    memberId: member.id,
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                }
                                className={`${teamRowBaseClass} ${teamRowHoverClass}`}
                              >
                                <span className={teamRowIconClass}>{member.initials}</span>
                                <span className="min-w-0">
                                  <span className={teamRowTitleClass}>{member.name}</span>
                                </span>
                                <span className="flex items-center gap-2">
                                  <span className={teamRowMetaClass}>
                                    {[
                                      member.role === 'lead' ? 'Lead' : 'Member',
                                      member.email ?? null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </span>
                                  <span className={teamRowMetaClass}>
                                    {typeof member.open_task_count === 'number'
                                      ? `${member.open_task_count} open`
                                      : '0 open'}
                                  </span>
                                  <span className={teamRowMetaClass}>
                                    {typeof member.active_project_count === 'number'
                                      ? `${member.active_project_count} projects`
                                      : '0 projects'}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-[var(--ledger-text-muted)]">
                            No members yet.
                          </div>
                        ),
                        teamMembers.length
                      )}
                    </div>
                  ) : null}
                </div>
                {renderRightPanel()}
              </section>
            </section>
          )}
        </div>
      </main>

      <ModalOverlay
        isOpen={isNewTeamOpen}
        onClose={closeNewTeamComposer}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[560px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <form onSubmit={handleCreateTeam}>
          <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3.5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--ledger-text-primary)]">New team</h2>
              <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
                Create a group for shared ownership.
              </p>
            </div>
            <ModalCloseButton onClick={closeNewTeamComposer} ariaLabel="Close new team modal" />
          </div>

          <div className="space-y-3 px-4 py-4">
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(140px,0.9fr)] gap-3">
              <label className="block space-y-1.5">
                <span className={teamsTheme.label}>Team name</span>
                <input
                  value={teamNameDraft}
                  onChange={(event) => setTeamNameDraft(event.target.value)}
                  className={teamsTheme.modalInput}
                  placeholder="Main Room"
                  autoFocus
                />
              </label>
              <label className="block space-y-1.5">
                <span className={teamsTheme.label}>Identifier</span>
                <input
                  value={teamIdentifierDraft}
                  onChange={(event) => setTeamIdentifierDraft(event.target.value.toUpperCase())}
                  className={teamsTheme.modalInput}
                  placeholder="MAIN"
                />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className={teamsTheme.label}>Description</span>
              <input
                value={teamDescriptionDraft}
                onChange={(event) => setTeamDescriptionDraft(event.target.value)}
                className={teamsTheme.modalInput}
                placeholder="Optional"
              />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <span className={teamsTheme.label}>Color</span>
                <div className="flex gap-2">
                  {teamColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setTeamColorDraft(color)}
                      className={`h-7 w-7 rounded-full border-2 ${
                        teamColorDraft === color
                          ? 'border-[var(--ledger-text-primary)]'
                          : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`Use ${color}`}
                    />
                  ))}
                </div>
              </div>

              <div className="min-w-[240px] flex-1 space-y-2">
                <span className={teamsTheme.label}>Members</span>
                <div className="flex items-center gap-2">
                  <select
                    value={newTeamMemberToAddId}
                    onChange={(event) => {
                      const nextMemberId = event.target.value;
                      if (!nextMemberId) return;
                      setNewTeamMemberIds((current) =>
                        current.includes(nextMemberId) ? current : [...current, nextMemberId]
                      );
                      setNewTeamMemberToAddId('');
                    }}
                    className="inline-flex h-8 min-w-[190px] flex-1 items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-xs font-medium text-[var(--ledger-text-secondary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
                  >
                    <option value="">Add workspace members</option>
                    {newTeamMemberOptions
                      .filter((member) => !newTeamMemberIds.includes(member.id))
                      .map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                  </select>
                </div>
                {newTeamMemberIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {newTeamMemberIds.map((memberId) => {
                      const member = workspaceMembers.find((item) => item.id === memberId);
                      if (!member) return null;
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => {
                            setNewTeamMemberIds((current) =>
                              current.filter((id) => id !== member.id)
                            );
                          }}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                          title={member.name}
                        >
                          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[9px] font-semibold text-[var(--ledger-text-secondary)]">
                            {member.initials}
                          </span>
                          <span className="max-w-[160px] truncate">{member.name}</span>
                          <X size={10} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-4 py-3.5">
            <button type="button" onClick={closeNewTeamComposer} className={teamsTheme.action}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!teamNameDraft.trim()}
              className={teamsTheme.primaryAction}
            >
              Create team
            </button>
          </div>
        </form>
      </ModalOverlay>

      <ModalOverlay
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-md rounded-2xl border p-5"
      >
        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <h2 className="text-lg font-medium text-[var(--ledger-text-primary)]">
              {inviteTeam ? `Invite to ${inviteTeam.name}` : 'Invite members'}
            </h2>
            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
              {inviteTeam
                ? `They will join ${workspaceName} and can be added to this team.`
                : `Invite people to ${workspaceName}.`}
            </p>
          </div>
          <label className="block space-y-1.5">
            <span className={teamsTheme.label}>Email</span>
            <input
              type="email"
              value={inviteEmailDraft}
              onChange={(event) => setInviteEmailDraft(event.target.value)}
              className={teamsTheme.modalInput}
              placeholder="name@example.com"
              autoFocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className={teamsTheme.label}>Role</span>
            <select
              value={inviteRoleDraft}
              onChange={(event) => setInviteRoleDraft(event.target.value as 'member' | 'admin')}
              className={teamsTheme.modalInput}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsInviteOpen(false)}
              className={teamsTheme.action}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!inviteEmailDraft.trim()}
              className={teamsTheme.primaryAction}
            >
              Send invite
            </button>
          </div>
        </form>
      </ModalOverlay>

      <ModalOverlay
        isOpen={Boolean(addMemberTeam)}
        onClose={() => setAddMemberTeamId(null)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-md rounded-2xl border p-5"
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium text-[var(--ledger-text-primary)]">
              Add member to {addMemberTeam?.name}
            </h2>
          </div>
          <label className="flex h-9 items-center gap-2 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3">
            <Search size={14} className="text-[var(--ledger-text-muted)]" />
            <input
              value={memberSearchDraft}
              onChange={(event) => setMemberSearchDraft(event.target.value)}
              placeholder="Search workspace members..."
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
              autoFocus
            />
          </label>
          <div className="max-h-64 space-y-1 overflow-auto">
            {availableMembers.length > 0 ? (
              availableMembers.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => addMemberToTeam(member)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                >
                  <MemberAvatar member={member} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                      {member.name}
                    </span>
                    <span className="block truncate text-xs text-[var(--ledger-text-muted)]">
                      {member.email}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2 py-4 text-sm text-[var(--ledger-text-muted)]">
                No available workspace members.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setAddMemberTeamId(null);
              openInviteForTeam(addMemberTeamId);
            }}
            className={teamsTheme.action}
          >
            Invite someone new
          </button>
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={isProjectLinkOpen}
        onClose={() => setIsProjectLinkOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-md rounded-2xl border p-5"
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium text-[var(--ledger-text-primary)]">
              Add project to {openedTeam?.name}
            </h2>
            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
              Projects added here surface their notes and milestones in this team.
            </p>
          </div>
          <label className="flex h-9 items-center gap-2 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3">
            <Search size={14} className="text-[var(--ledger-text-muted)]" />
            <input
              value={projectLinkSearch}
              onChange={(event) => setProjectLinkSearch(event.target.value)}
              placeholder="Search existing projects..."
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
              autoFocus
            />
          </label>
          <div className="max-h-56 overflow-auto rounded-2xl border border-[color:var(--ledger-border-subtle)]">
            {projectLinkableItems.length > 0 ? (
              projectLinkableItems.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => void linkExistingProject(project.id)}
                  className="flex w-full items-center justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 text-left transition last:border-b-0 hover:bg-[var(--ledger-surface-hover)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                      {project.name}
                    </span>
                    <span className="block truncate text-xs text-[var(--ledger-text-muted)]">
                      {project.owner_team_id ? 'Already owned by a team' : 'Workspace project'}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-[var(--ledger-text-muted)]">
                No matching projects.
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Create new</p>
            <label className="block space-y-1.5">
              <span className={teamsTheme.label}>Project name</span>
              <input
                value={projectLinkNameDraft}
                onChange={(event) => setProjectLinkNameDraft(event.target.value)}
                className={teamsTheme.modalInput}
                placeholder="New project"
              />
            </label>
            <button
              type="button"
              onClick={() => void createProjectForTeam()}
              disabled={!projectLinkNameDraft.trim()}
              className={teamsTheme.primaryAction}
            >
              Create project
            </button>
          </div>
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={isNoteLinkOpen}
        onClose={() => setIsNoteLinkOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-md rounded-2xl border p-5"
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium text-[var(--ledger-text-primary)]">
              Link note to {openedTeam?.name}
            </h2>
            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
              Notes linked here appear in this team, including notes attached to owned projects.
            </p>
          </div>
          <label className="flex h-9 items-center gap-2 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3">
            <Search size={14} className="text-[var(--ledger-text-muted)]" />
            <input
              value={noteLinkSearch}
              onChange={(event) => setNoteLinkSearch(event.target.value)}
              placeholder="Search notes..."
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
              autoFocus
            />
          </label>
          <div className="max-h-56 overflow-auto rounded-2xl border border-[color:var(--ledger-border-subtle)]">
            {noteLinkableItems.length > 0 ? (
              noteLinkableItems.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => void linkExistingNote(note.id)}
                  className="flex w-full items-center justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 text-left transition last:border-b-0 hover:bg-[var(--ledger-surface-hover)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                      {note.title}
                    </span>
                    <span className="block truncate text-xs text-[var(--ledger-text-muted)]">
                      {note.updated_at
                        ? `Updated ${formatShortDate(note.updated_at)}`
                        : 'Workspace note'}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-[var(--ledger-text-muted)]">
                No matching notes.
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Create new</p>
            <label className="block space-y-1.5">
              <span className={teamsTheme.label}>Note title</span>
              <input
                value={noteLinkTitleDraft}
                onChange={(event) => setNoteLinkTitleDraft(event.target.value)}
                className={teamsTheme.modalInput}
                placeholder="Project notes"
              />
            </label>
            <button
              type="button"
              onClick={() => void createNoteForTeam()}
              disabled={!noteLinkTitleDraft.trim()}
              className={teamsTheme.primaryAction}
            >
              Create note
            </button>
          </div>
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={Boolean(assignWorkTeam)}
        onClose={closeAssignWorkModal}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[640px] rounded-2xl border p-0 overflow-hidden"
      >
        {assignWorkTeam ? (
          <div className="bg-[var(--ledger-surface-card)]">
            <div className="border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
              <h2 className="text-lg font-medium text-[var(--ledger-text-primary)]">
                Assign work to {assignWorkTeam.name}
              </h2>
            </div>
            {assignWorkSuccess ? (
              <div className="space-y-4 px-5 py-5">
                <p className="text-sm text-[var(--ledger-text-secondary)]">{assignWorkSuccess}</p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetAssignWorkComposer}
                    className={teamsTheme.action}
                  >
                    Assign another
                  </button>
                  <button
                    type="button"
                    onClick={closeAssignWorkModal}
                    className={teamsTheme.primaryAction}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 px-5 py-5">
                {assignWorkMode === 'search' ? (
                  <>
                    <label className="flex h-9 items-center gap-2 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3">
                      <Search size={14} className="text-[var(--ledger-text-muted)]" />
                      <input
                        value={assignWorkSearch}
                        onChange={(event) => setAssignWorkSearch(event.target.value)}
                        placeholder="Search tasks or milestones..."
                        className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
                        autoFocus
                      />
                    </label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                          {hasAssignWorkQuery ? 'Search results' : 'Recent work'}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setAssignWorkMode('new-task');
                            setAssignWorkError(null);
                          }}
                          className="text-xs font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
                        >
                          + New task
                        </button>
                      </div>
                      <div className="max-h-72 overflow-auto rounded-2xl border border-[color:var(--ledger-border-subtle)]">
                        {visibleAssignWorkItems.length > 0 ? (
                          visibleAssignWorkItems.map((item) => (
                            <button
                              key={workItemKey(item)}
                              type="button"
                              onClick={() => assignExistingWorkItem(item)}
                              className="flex w-full items-start gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 text-left transition last:border-b-0 hover:bg-[var(--ledger-surface-hover)]"
                            >
                              {item.kind === 'task' ? (
                                <Circle
                                  size={14}
                                  className="mt-0.5 text-[var(--ledger-text-muted)]"
                                />
                              ) : (
                                <Diamond
                                  size={14}
                                  className="mt-0.5 text-[var(--ledger-text-muted)]"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                                  {item.title}
                                </p>
                                <p className="truncate text-xs text-[var(--ledger-text-muted)]">
                                  {item.detail}
                                </p>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-8 text-sm text-[var(--ledger-text-muted)]">
                            <p>No matching work.</p>
                            <p className="mt-1">Create a new task or milestone for this team.</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                        Create new
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAssignWorkMode('new-task');
                            setAssignWorkError(null);
                          }}
                          className={teamsTheme.action}
                        >
                          + New task
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAssignWorkMode('new-milestone');
                            setAssignWorkError(null);
                          }}
                          className={teamsTheme.action}
                        >
                          + New milestone
                        </button>
                      </div>
                    </div>
                  </>
                ) : assignWorkMode === 'new-task' ? (
                  <form onSubmit={assignTask} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                        New task
                      </p>
                      <button
                        type="button"
                        onClick={() => setAssignWorkMode('search')}
                        className="text-xs font-medium text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]"
                      >
                        Back
                      </button>
                    </div>
                    <label className="block space-y-1.5">
                      <span className={teamsTheme.label}>Task title</span>
                      <input
                        value={taskComposerTitle}
                        onChange={(event) => setTaskComposerTitle(event.target.value)}
                        className={teamsTheme.modalInput}
                        placeholder="Buy metasteps plan"
                        autoFocus
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className={teamsTheme.label}>Project</span>
                      <select
                        value={taskComposerProjectId}
                        onChange={(event) => setTaskComposerProjectId(event.target.value)}
                        className={teamsTheme.modalInput}
                      >
                        <option value="">Optional</option>
                        {workspaceProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1.5">
                        <span className={teamsTheme.label}>Due date</span>
                        <input
                          type="date"
                          value={taskComposerDueDate}
                          onChange={(event) => setTaskComposerDueDate(event.target.value)}
                          className={teamsTheme.modalInput}
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className={teamsTheme.label}>Priority</span>
                        <select
                          value={taskComposerPriority}
                          onChange={(event) =>
                            setTaskComposerPriority(
                              event.target.value as typeof taskComposerPriority
                            )
                          }
                          className={teamsTheme.modalInput}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </label>
                    </div>
                    <label className="block space-y-1.5">
                      <span className={teamsTheme.label}>Horizon</span>
                      <select
                        value={taskComposerHorizon}
                        onChange={(event) =>
                          setTaskComposerHorizon(event.target.value as typeof taskComposerHorizon)
                        }
                        className={teamsTheme.modalInput}
                      >
                        <option value="long_term">Long term</option>
                        <option value="today">Today</option>
                      </select>
                    </label>
                    {assignWorkError ? (
                      <p className="text-xs text-[color:#B42318]">{assignWorkError}</p>
                    ) : null}
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={closeAssignWorkModal}
                        className={teamsTheme.action}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!taskComposerTitle.trim()}
                        className={teamsTheme.primaryAction}
                      >
                        Assign task
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={assignMilestone} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                        New milestone
                      </p>
                      <button
                        type="button"
                        onClick={() => setAssignWorkMode('search')}
                        className="text-xs font-medium text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]"
                      >
                        Back
                      </button>
                    </div>
                    <label className="block space-y-1.5">
                      <span className={teamsTheme.label}>Milestone title</span>
                      <input
                        value={milestoneComposerTitle}
                        onChange={(event) => setMilestoneComposerTitle(event.target.value)}
                        className={teamsTheme.modalInput}
                        placeholder="Finish Meta Steps Exhibition"
                        autoFocus
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className={teamsTheme.label}>Project</span>
                      <select
                        value={milestoneComposerProjectId}
                        onChange={(event) => setMilestoneComposerProjectId(event.target.value)}
                        className={teamsTheme.modalInput}
                      >
                        <option value="">Select a project</option>
                        {workspaceProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1.5">
                        <span className={teamsTheme.label}>Date</span>
                        <input
                          type="date"
                          value={milestoneComposerDate}
                          onChange={(event) => setMilestoneComposerDate(event.target.value)}
                          className={teamsTheme.modalInput}
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className={teamsTheme.label}>Type</span>
                        <input
                          value={milestoneComposerType}
                          onChange={(event) => setMilestoneComposerType(event.target.value)}
                          className={teamsTheme.modalInput}
                          placeholder="Custom"
                        />
                      </label>
                    </div>
                    {assignWorkError ? (
                      <p className="text-xs text-[color:#B42318]">{assignWorkError}</p>
                    ) : null}
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={closeAssignWorkModal}
                        className={teamsTheme.action}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={
                          !milestoneComposerTitle.trim() ||
                          !milestoneComposerProjectId.trim() ||
                          !milestoneComposerDate.trim()
                        }
                        className={teamsTheme.primaryAction}
                      >
                        Assign milestone
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        ) : null}
      </ModalOverlay>

      {contextMenu ? (
        <div
          className="fixed z-[9999] w-48 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 shadow-[0_18px_50px_rgba(17,24,39,0.16)]"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 208)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 224)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <CompactButton onClick={() => openTeamDetail(contextMenu.teamId)}>
            Open team
          </CompactButton>
          <CompactButton
            onClick={() => {
              void window.desktopWindow?.openModule('teams', {
                kind: 'teams',
                focusContext: `team-settings:${contextMenu.teamId}`,
              } as any);
              setContextMenu(null);
            }}
          >
            Team settings
          </CompactButton>
          <CompactButton onClick={() => openInviteForTeam(contextMenu.teamId)}>
            Invite member
          </CompactButton>
          <CompactButton
            onClick={() => {
              const team = teams.find((item) => item.id === contextMenu.teamId);
              if (team)
                void navigator.clipboard
                  ?.writeText(`${window.location.origin}/teams/${team.id}`)
                  .catch(() => undefined);
              setContextMenu(null);
            }}
          >
            Copy team link
          </CompactButton>
          <CompactButton onClick={() => deleteTeam(contextMenu.teamId)} destructive>
            <span className="inline-flex items-center gap-2">
              <Trash2 size={13} />
              Delete team
            </span>
          </CompactButton>
        </div>
      ) : null}

      {resourceMenu ? (
        <div
          className="fixed z-[9999] w-56 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 shadow-[0_18px_50px_rgba(17,24,39,0.16)]"
          style={{
            left: Math.max(8, Math.min(resourceMenu.x - 224, window.innerWidth - 240)),
            top: Math.max(8, Math.min(resourceMenu.y, window.innerHeight - 280)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <CompactButton
            onClick={() => {
              setResourceMenu(null);
              setIsNoteLinkOpen(true);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <FileText size={13} />
              Existing note
            </span>
          </CompactButton>
          <CompactButton
            onClick={() => {
              setResourceMenu(null);
              setIsNoteLinkOpen(true);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Plus size={13} />
              New team note
            </span>
          </CompactButton>
          <CompactButton
            onClick={() => {
              setResourceMenu(null);
              openProjectLinkModal();
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Sparkles size={13} />
              Project
            </span>
          </CompactButton>
          <CompactButton
            onClick={() => {
              setResourceMenu(null);
              if (openedTeam) {
                openAssignWorkForTeam(openedTeam.id);
                setAssignWorkMode('new-task');
              }
            }}
          >
            <span className="inline-flex items-center gap-2">
              <ListTodo size={13} />
              Task
            </span>
          </CompactButton>
          <CompactButton
            onClick={() => {
              setResourceMenu(null);
              void window.desktopWindow?.openModule('calendar', {
                focusDate: todayKey(),
              });
            }}
          >
            <span className="inline-flex items-center gap-2">
              <CalendarDays size={13} />
              Calendar event
            </span>
          </CompactButton>
        </div>
      ) : null}

      {renderTeamRowContextMenu()}
    </div>
  );
};

const workItemKey = (item: { kind: 'task' | 'milestone'; sourceId: string }) =>
  `${item.kind}:${item.sourceId}`;

const teamWorkItemMatches = (item: TeamAssignedWorkItem, query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return item.searchText.includes(needle);
};

export default TeamsWindow;
