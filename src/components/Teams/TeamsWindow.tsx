import {
  Bell,
  Check,
  Circle,
  Diamond,
  Filter,
  Hash,
  Inbox,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { ModuleHeaderActionButton, ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import { ModalOverlay } from '../Common/ModalOverlay';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';

type TeamMember = {
  id: string;
  name: string;
  email?: string | null;
  role?: 'lead' | 'member';
  initials: string;
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
  notes: string[];
  currentUserRole?: 'lead' | 'member' | null;
};

type WorkspaceProjectRow = {
  id: string;
  name: string;
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

const teamColors = ['#FF5F40', '#D97706', '#0F766E', '#2563EB', '#7C3AED', '#475569'];
const tabs = ['Assigned', 'Projects', 'Milestones', 'Notes', 'Members'] as const;

const teamsTheme = {
  shell:
    'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none',
  content: 'flex-1 min-h-0 overflow-auto bg-[var(--ledger-background)] px-6 py-7',
  page: 'mx-auto flex min-h-full w-full max-w-7xl flex-col gap-7',
  pageTitle: 'text-[32px] font-normal leading-tight tracking-tight text-[var(--ledger-text-primary)]',
  subtitle: 'text-sm font-light text-[var(--ledger-text-muted)]',
  action:
    'inline-flex h-8 items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  primaryAction:
    'inline-flex h-8 items-center gap-2 rounded-full border border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)] px-3 text-xs font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)]',
  panel:
    'rounded-[22px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]',
  row:
    'group grid w-full grid-cols-[minmax(220px,1.4fr)_minmax(170px,1fr)_90px_34px] items-center gap-4 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 text-left last:border-b-0 transition hover:bg-[var(--ledger-surface-hover)]',
  rowSelected:
    'bg-[color:rgba(255,95,64,0.08)] hover:bg-[color:rgba(255,95,64,0.11)]',
  label: 'text-[11px] font-medium text-[var(--ledger-text-muted)]',
  title: 'text-[13px] font-medium text-[var(--ledger-text-primary)]',
  meta: 'text-[11px] leading-4 text-[var(--ledger-text-muted)]',
  chip:
    'inline-flex h-5 items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-[10px] font-medium text-[var(--ledger-text-secondary)]',
  rightPanel:
    'space-y-5 border-t border-[color:var(--ledger-border-subtle)] pt-6 lg:sticky lg:top-0 lg:self-start lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0',
  sectionTitle: 'text-xs font-medium text-[var(--ledger-text-primary)]',
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

const MemberAvatar = ({ member }: { member: TeamMember }) => (
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

export const TeamsWindow = () => {
  const api = useApi();
  const { user } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext();
  const workspaceName = activeWorkspace?.name?.trim() || 'Workspace';

  const [workspaceMembers, setWorkspaceMembers] = useState<TeamMember[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceProjectRow[]>([]);
  const [workspaceTasks, setWorkspaceTasks] = useState<WorkspaceTaskRow[]>([]);
  const [workspaceMilestones, setWorkspaceMilestones] = useState<WorkspaceMilestoneRow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [openedTeamId, setOpenedTeamId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Assigned');
  const [query, setQuery] = useState('');
  const [isNewTeamOpen, setIsNewTeamOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteTeamId, setInviteTeamId] = useState<string | null>(null);
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<TeamContextMenu>(null);

  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [teamIdentifierDraft, setTeamIdentifierDraft] = useState('');
  const [teamDescriptionDraft, setTeamDescriptionDraft] = useState('');
  const [teamColorDraft, setTeamColorDraft] = useState(teamColors[0]);
  const [inviteEmailDraft, setInviteEmailDraft] = useState('');
  const [inviteRoleDraft, setInviteRoleDraft] = useState<'member' | 'admin'>('member');
  const [memberSearchDraft, setMemberSearchDraft] = useState('');
  const [assignWorkTeamId, setAssignWorkTeamId] = useState<string | null>(null);
  const [assignWorkSearch, setAssignWorkSearch] = useState('');
  const [assignWorkMode, setAssignWorkMode] = useState<'search' | 'new-task' | 'new-milestone'>('search');
  const [assignWorkSuccess, setAssignWorkSuccess] = useState<string | null>(null);
  const [taskComposerTitle, setTaskComposerTitle] = useState('');
  const [taskComposerProjectId, setTaskComposerProjectId] = useState('');
  const [taskComposerDueDate, setTaskComposerDueDate] = useState('');
  const [taskComposerPriority, setTaskComposerPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [taskComposerHorizon, setTaskComposerHorizon] = useState<'today' | 'long_term'>('long_term');
  const [milestoneComposerTitle, setMilestoneComposerTitle] = useState('');
  const [milestoneComposerProjectId, setMilestoneComposerProjectId] = useState('');
  const [milestoneComposerDate, setMilestoneComposerDate] = useState('');
  const [milestoneComposerType, setMilestoneComposerType] = useState('Custom');
  const [assignWorkError, setAssignWorkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadMembers = async () => {
      if (!activeWorkspaceId) {
        setWorkspaceMembers([]);
        return;
      }

      try {
        const payload = (await api.getWorkspaceMembers(activeWorkspaceId)) as {
          members?: WorkspaceMemberPayload[];
        };
        if (cancelled) return;

        const members = Array.isArray(payload?.members)
          ? payload.members.map((member) => {
              const name = member.full_name?.trim() || member.email?.split('@')[0] || 'Workspace member';
              return {
                id: member.user_id,
                name,
                email: member.email ?? null,
                initials: getInitials(name, member.email),
                role: member.user_id === user?.id ? ('lead' as const) : undefined,
              };
            })
          : [];

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
        return;
      }

      try {
        const [projectsPayload, tasksPayload, milestonesPayload] = await Promise.all([
          api.getProjects({ includeCompleted: true }),
          api.getTasks(),
          api.getWorkspaceProjectMilestones(),
        ]);

        if (cancelled) return;

        const projects = Array.isArray(projectsPayload)
          ? projectsPayload.map((project) => ({
              id: String(project.id),
              name: String(project.name ?? ''),
            }))
          : [];

        const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

        const tasks = Array.isArray(tasksPayload)
          ? (tasksPayload as WorkspaceTaskRow[])
              .filter((task) => String(task.status ?? '').toLowerCase() !== 'completed')
              .map((task) => ({
                ...task,
                project_name:
                  task.project_name ?? (task.project_id ? projectNameById.get(task.project_id) ?? null : null),
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

        setWorkspaceProjects(projects);
        setWorkspaceTasks(tasks);
        setWorkspaceMilestones(milestones);
      } catch {
        if (!cancelled) {
          setWorkspaceProjects([]);
          setWorkspaceTasks([]);
          setWorkspaceMilestones([]);
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

      try {
        const payload = (await api.getTeams()) as { teams?: Team[] } | Team[];
        if (cancelled) return;

        const nextTeams = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.teams)
            ? payload.teams
            : [];
        setTeams(nextTeams);
        setSelectedTeamId((current) =>
          current && nextTeams.some((team) => team.id === current) ? current : nextTeams[0]?.id ?? null
        );
        setOpenedTeamId((current) =>
          current && nextTeams.some((team) => team.id === current) ? current : null
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
  }, [activeWorkspaceId, api]);

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
    setTeamIdentifierDraft(makeIdentifier(teamNameDraft));
  }, [teamNameDraft]);

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
    const addMemberTeam = teams.find((team) => team.id === addMemberTeamId) ?? null;
    const inviteTeam = teams.find((team) => team.id === inviteTeamId) ?? null;

  const availableMembers = useMemo(() => {
    if (!addMemberTeam) return [];
    const existing = new Set(addMemberTeam.members.map((member) => member.id));
    const needle = memberSearchDraft.trim().toLowerCase();
    return workspaceMembers.filter((member) => {
      if (existing.has(member.id)) return false;
      if (!needle) return true;
      return member.name.toLowerCase().includes(needle) || member.email?.toLowerCase().includes(needle);
    });
  }, [addMemberTeam, memberSearchDraft, workspaceMembers]);

  const resetNewTeamForm = () => {
    setTeamNameDraft('');
    setTeamIdentifierDraft('');
    setTeamDescriptionDraft('');
    setTeamColorDraft(teamColors[0]);
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
      })) as { team?: Team };
      setIsNewTeamOpen(false);
      resetNewTeamForm();
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
      await api.addTeamMember(addMemberTeamId, { user_id: member.id, role: member.role ?? 'member' });
      setAddMemberTeamId(null);
      setMemberSearchDraft('');
      await reloadTeams(addMemberTeamId);
    } catch (error) {
      console.error(error);
    }
  };

  const removeMemberFromTeam = async (teamId: string, memberId: string) => {
    try {
      await api.removeTeamMember(teamId, memberId);
      await reloadTeams(teamId);
    } catch (error) {
      console.error(error);
    }
  };

  const deleteTeam = async (teamId: string) => {
    const team = teams.find((item) => item.id === teamId);
    if (!team) return;
    const confirmed = window.confirm(`Delete ${team.name}? Assigned work will remain in the workspace.`);
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
    (assignWorkTeam?.assignedWork ?? []).map((item) => workItemKey({ kind: item.kind, sourceId: item.sourceId }))
  );

  const workspaceWorkItems = useMemo(() => {
    const taskItems = workspaceTasks
      .map<TeamAssignedWorkItem>((task) => {
        const projectName = String(task.project_name ?? '').trim() || workspaceName;
        const dueLabel = formatShortDate(task.due_date);
        const detail = [
          'Task',
          projectName,
          dueLabel ? `Due ${dueLabel}` : null,
        ]
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
          searchText: [task.title, projectName, detail, task.priority, task.task_horizon].filter(Boolean).join(' ').toLowerCase(),
          assignedAt: task.updated_at ?? task.created_at ?? new Date().toISOString(),
        };
      })
      .filter((item) => !assignedWorkSet.has(workItemKey(item)));

    const milestoneItems = workspaceMilestones
      .map<TeamAssignedWorkItem>((milestone) => {
        const projectName = String(milestone.project_name ?? '').trim() || workspaceName;
        const dueLabel = formatShortDate(milestone.milestone_date);
        const detail = [
          'Milestone',
          projectName,
          dueLabel ?? null,
        ]
          .filter(Boolean)
          .join(' · ');
        return {
          kind: 'milestone' as const,
          sourceId: milestone.id,
          title: milestone.title,
          projectId: milestone.project_id ?? null,
          projectName,
          detail,
          dueDate: milestone.milestone_date ?? null,
          typeLabel: milestone.type ?? 'Custom',
          searchText: [milestone.title, projectName, detail, milestone.type].filter(Boolean).join(' ').toLowerCase(),
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

  const assignedRows = openedTeam?.assignedWork ?? [];
  const hasAssignWorkQuery = assignWorkSearch.trim().length > 0;
  const visibleAssignWorkItems = hasAssignWorkQuery ? filteredAssignableItems : recentAssignableItems;

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
        await api.updateTask(item.sourceId, { assigned_team_id: assignWorkTeam.id });
      } else {
        await api.updateProjectMilestone(item.sourceId, { assigned_team_id: assignWorkTeam.id });
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
      const dueDate = taskComposerHorizon === 'today' ? todayKey() : taskComposerDueDate.trim() || null;
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

  const renderRightPanel = () => {
    if (!selectedTeam) return null;

    return (
      <aside className={teamsTheme.rightPanel}>
        <div>
          <p className={teamsTheme.label}>Team</p>
          <div className="mt-2 flex items-center gap-3">
            <TeamBadge team={selectedTeam} />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-medium text-[var(--ledger-text-primary)]">
                {selectedTeam.name}
              </h2>
              <p className="text-xs text-[var(--ledger-text-muted)]">
                {selectedTeam.members.length} members · {workspaceName}
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <p className={teamsTheme.sectionTitle}>Identifier</p>
          <p className="font-mono text-xs font-semibold text-[var(--ledger-text-secondary)]">
            {selectedTeam.identifier}
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className={teamsTheme.sectionTitle}>Members</p>
            <button
              type="button"
              onClick={() => setAddMemberTeamId(selectedTeam.id)}
              className="text-xs font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
            >
              + Add
            </button>
          </div>
          <div className="space-y-1">
            {selectedTeam.members.map((member) => (
              <div key={member.id} className="group flex items-center gap-2 rounded-xl px-2 py-1.5">
                <MemberAvatar member={member} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--ledger-text-secondary)]">{member.name}</p>
                  {member.role === 'lead' ? <p className={teamsTheme.meta}>Lead</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => removeMemberFromTeam(selectedTeam.id, member.id)}
                  className="opacity-0 transition group-hover:opacity-100"
                  title="Remove member"
                  aria-label={`Remove ${member.name}`}
                >
                  <X size={13} className="text-[var(--ledger-text-muted)]" />
                </button>
              </div>
            ))}
            {selectedTeam.members.length === 0 ? <p className={teamsTheme.meta}>No members yet.</p> : null}
          </div>
        </div>
        <div className="space-y-2">
          <p className={teamsTheme.sectionTitle}>Assigned work</p>
          <p className={teamsTheme.meta}>
            {selectedTeam.assignedCount} tasks · {selectedTeam.milestoneCount} milestones
          </p>
        </div>
        <div className="space-y-2">
          <p className={teamsTheme.sectionTitle}>Active projects</p>
          {selectedTeam.activeProjects.length > 0 ? (
            selectedTeam.activeProjects.map((project) => (
              <p key={project} className="text-xs font-medium text-[var(--ledger-text-secondary)]">
                {project}
              </p>
            ))
          ) : (
            <p className={teamsTheme.meta}>No linked projects yet.</p>
          )}
        </div>
        <div className="space-y-1">
          <p className={teamsTheme.sectionTitle}>Quick actions</p>
          <CompactButton onClick={() => setOpenedTeamId(selectedTeam.id)}>Open team</CompactButton>
          <CompactButton onClick={() => openInviteForTeam(selectedTeam.id)}>Invite member</CompactButton>
          <CompactButton onClick={() => setIsNewTeamOpen(true)}>Create team</CompactButton>
          <CompactButton onClick={() => deleteTeam(selectedTeam.id)} destructive>
            Delete team
          </CompactButton>
        </div>
      </aside>
    );
  };

  return (
    <div className={teamsTheme.shell}>
      <ModuleWindowHeader
        title="Teams"
        icon={<Users size={17} />}
        compact
        onClose={() => window.desktopWindow?.closeModule('teams')}
        onMinimize={() => window.desktopWindow?.minimizeModule('teams')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('teams')}
        primaryActions={
          <>
            <ModuleHeaderActionButton
              title="Invite member"
              ariaLabel="Invite member"
              icon={<UserPlus size={14} />}
              onClick={() => openInviteForTeam(openedTeamId ?? selectedTeamId)}
            >
              Invite member
            </ModuleHeaderActionButton>
            <ModuleHeaderActionButton
              title="New team"
              ariaLabel="New team"
              icon={<Plus size={14} />}
              onClick={() => setIsNewTeamOpen(true)}
            >
              New team
            </ModuleHeaderActionButton>
          </>
        }
        stripActions={
          <>
            <button
              type="button"
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
              title="Inbox"
              aria-label="Open inbox"
            >
              <Inbox size={14} />
            </button>
            <button
              type="button"
              onClick={() => window.desktopWindow?.openModule('notifications')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
              title="Notifications"
              aria-label="Open notifications"
            >
              <Bell size={14} />
            </button>
          </>
        }
      />

      <main className={teamsTheme.content}>
        <div className={teamsTheme.page}>
          {!openedTeam ? (
            <>
            

              <div className="flex min-h-0 flex-1 flex-col">
                <section className="min-h-0 flex-1">
                  <div className={`${teamsTheme.panel} flex h-full flex-col`}>
                    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
                      <div className="flex items-baseline gap-2">
                        <h2 className="text-sm font-medium text-[var(--ledger-text-primary)]">Teams</h2>
                        <span className="text-sm text-[var(--ledger-text-muted)]">{filteredTeams.length}</span>
                      </div>
                      <div className="flex w-full max-w-xl items-center gap-2">
                        <button type="button" className={teamsTheme.action}>
                          <Filter size={13} />
                          Filter
                        </button>
                        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3">
                          <Search size={13} className="text-[var(--ledger-text-muted)]" />
                          <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Filter teams..."
                            className="min-w-0 flex-1 bg-transparent text-xs text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
                          />
                        </label>
                      </div>
                    </div>
                    <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(170px,1fr)_90px_34px] gap-4 border-b border-[color:var(--ledger-border-subtle)] px-4 py-2 text-[11px] font-medium text-[var(--ledger-text-muted)]">
                      <span>Name</span>
                      <span>Members</span>
                      <span>Identifier</span>
                      <span />
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                      {filteredTeams.length > 0 ? (
                        filteredTeams.map((team) => (
                          <button
                            key={team.id}
                            type="button"
                            onClick={() => setSelectedTeamId(team.id)}
                            onDoubleClick={() => setOpenedTeamId(team.id)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setSelectedTeamId(team.id);
                              setContextMenu({ teamId: team.id, x: event.clientX, y: event.clientY });
                            }}
                            className={`${teamsTheme.row} ${selectedTeamId === team.id ? teamsTheme.rowSelected : ''}`}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <TeamBadge team={team} />
                              <span className="min-w-0">
                                <span className={teamsTheme.title}>{team.name}</span>
                                <span className="mt-0.5 block truncate text-[11px] text-[var(--ledger-text-muted)]">
                                  {team.description || `${team.members.length} members · ${team.assignedCount} assigned`}
                                </span>
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
                                setContextMenu({ teamId: team.id, x: event.clientX, y: event.clientY });
                              }}
                            >
                              <MoreHorizontal size={14} className="text-[var(--ledger-text-muted)]" />
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="flex min-h-[280px] items-center justify-center px-4 py-8">
                          <div className="max-w-sm text-center">
                            <p className="text-sm font-medium text-[var(--ledger-text-primary)]">No teams yet.</p>
                            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
                              Create teams to group people and assign work inside this workspace.
                            </p>
                            <div className="mt-4 flex justify-center gap-2">
                            <button type="button" onClick={() => setIsNewTeamOpen(true)} className={teamsTheme.primaryAction}>
                              Create team
                            </button>
                            <button type="button" onClick={() => openInviteForTeam(null)} className={teamsTheme.action}>
                              Invite member
                            </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <section className="grid min-h-0 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-6">
                <button
                  type="button"
                  onClick={() => setOpenedTeamId(null)}
                  className="text-xs font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
                >
                  Back to teams
                </button>
                <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <TeamBadge team={openedTeam} />
                    <div className="min-w-0">
                      <h1 className={teamsTheme.pageTitle}>{openedTeam.name}</h1>
                      <p className={teamsTheme.subtitle}>
                        {openedTeam.members.length} members · {workspaceName}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setAddMemberTeamId(openedTeam.id)} className={teamsTheme.action}>
                      <Plus size={13} />
                      Add member
                    </button>
                    <button type="button" onClick={() => openInviteForTeam(openedTeam.id)} className={teamsTheme.action}>
                      <UserPlus size={13} />
                      Invite member
                    </button>
                  </div>
                </header>
                <div className="flex gap-1 overflow-x-auto border-b border-[color:var(--ledger-border-subtle)]">
                  {tabs.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`h-9 whitespace-nowrap border-b px-3 text-xs font-medium transition ${
                        activeTab === tab
                          ? 'border-[color:var(--ledger-accent)] text-[var(--ledger-text-primary)]'
                          : 'border-transparent text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className={teamsTheme.panel}>
                  {activeTab === 'Assigned' ? (
                    <div>
                      <div className="border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
                        <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Needs attention</p>
                      </div>
                      {openedTeam.assignedCount > 0 ? (
                        assignedRows.map((row) => (
                          <div
                            key={workItemKey(row)}
                            className="flex items-center gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 last:border-b-0"
                          >
                            {row.kind === 'task' ? (
                              <Circle size={14} className="text-[var(--ledger-text-muted)]" />
                            ) : (
                              <Diamond size={14} className="text-[var(--ledger-text-muted)]" />
                            )}
                            <div className="min-w-0">
                              <p className={teamsTheme.title}>{row.title}</p>
                              <p className={teamsTheme.meta}>{row.detail}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="flex min-h-[240px] items-center justify-center px-4 py-10">
                          <div className="max-w-sm text-center">
                            <p className="text-sm font-medium text-[var(--ledger-text-primary)]">No assigned work yet.</p>
                            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
                              Assign a task or milestone to this team.
                            </p>
                            <button type="button" onClick={openAssignWorkToCurrentTeam} className={`mt-4 ${teamsTheme.action}`}>
                              Assign work
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : activeTab === 'Members' ? (
                    <div>
                      <div className="flex items-center justify-between border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
                        <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Members</p>
                        <button
                          type="button"
                          onClick={() => setAddMemberTeamId(openedTeam.id)}
                          className="text-xs font-medium text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]"
                        >
                          + Add member
                        </button>
                      </div>
                      {openedTeam.members.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 last:border-b-0"
                        >
                          <MemberAvatar member={member} />
                          <div className="min-w-0 flex-1">
                            <p className={teamsTheme.title}>{member.name}</p>
                            <p className={teamsTheme.meta}>{member.email ?? (member.role === 'lead' ? 'Lead' : 'Member')}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeMemberFromTeam(openedTeam.id, member.id)}
                            className="text-xs text-[var(--ledger-text-muted)] hover:text-[color:#B42318]"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-10">
                      <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                        {activeTab} will use team-owned work.
                      </p>
                      <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
                        This tab is ready for the team assignment API when tasks, milestones, notes, and projects support team ownership.
                      </p>
                    </div>
                  )}
                </div>
              </div>
              {renderRightPanel()}
            </section>
          )}
        </div>
      </main>

      <ModalOverlay
        isOpen={isNewTeamOpen}
        onClose={() => setIsNewTeamOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-md rounded-2xl border p-5"
      >
        <form onSubmit={handleCreateTeam} className="space-y-4">
          <div>
            <h2 className="text-lg font-medium text-[var(--ledger-text-primary)]">New team</h2>
            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">Create a group for shared ownership.</p>
          </div>
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
          <label className="block space-y-1.5">
            <span className={teamsTheme.label}>Description</span>
            <input
              value={teamDescriptionDraft}
              onChange={(event) => setTeamDescriptionDraft(event.target.value)}
              className={teamsTheme.modalInput}
              placeholder="Optional"
            />
          </label>
          <div className="space-y-2">
            <span className={teamsTheme.label}>Color</span>
            <div className="flex gap-2">
              {teamColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setTeamColorDraft(color)}
                  className={`h-7 w-7 rounded-full border-2 ${
                    teamColorDraft === color ? 'border-[var(--ledger-text-primary)]' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={`Use ${color}`}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setIsNewTeamOpen(false)} className={teamsTheme.action}>
              Cancel
            </button>
            <button type="submit" disabled={!teamNameDraft.trim()} className={teamsTheme.primaryAction}>
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
            <button type="button" onClick={() => setIsInviteOpen(false)} className={teamsTheme.action}>
              Cancel
            </button>
            <button type="submit" disabled={!inviteEmailDraft.trim()} className={teamsTheme.primaryAction}>
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
                    <span className="block truncate text-xs text-[var(--ledger-text-muted)]">{member.email}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2 py-4 text-sm text-[var(--ledger-text-muted)]">No available workspace members.</p>
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
                  <button type="button" onClick={resetAssignWorkComposer} className={teamsTheme.action}>
                    Assign another
                  </button>
                  <button type="button" onClick={closeAssignWorkModal} className={teamsTheme.primaryAction}>
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
                                <Circle size={14} className="mt-0.5 text-[var(--ledger-text-muted)]" />
                              ) : (
                                <Diamond size={14} className="mt-0.5 text-[var(--ledger-text-muted)]" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">{item.title}</p>
                                <p className="truncate text-xs text-[var(--ledger-text-muted)]">{item.detail}</p>
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
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Create new</p>
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
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">New task</p>
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
                          onChange={(event) => setTaskComposerPriority(event.target.value as typeof taskComposerPriority)}
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
                        onChange={(event) => setTaskComposerHorizon(event.target.value as typeof taskComposerHorizon)}
                        className={teamsTheme.modalInput}
                      >
                        <option value="long_term">Long term</option>
                        <option value="today">Today</option>
                      </select>
                    </label>
                    {assignWorkError ? <p className="text-xs text-[color:#B42318]">{assignWorkError}</p> : null}
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" onClick={closeAssignWorkModal} className={teamsTheme.action}>
                        Cancel
                      </button>
                      <button type="submit" disabled={!taskComposerTitle.trim()} className={teamsTheme.primaryAction}>
                        Assign task
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={assignMilestone} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">New milestone</p>
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
                    {assignWorkError ? <p className="text-xs text-[color:#B42318]">{assignWorkError}</p> : null}
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" onClick={closeAssignWorkModal} className={teamsTheme.action}>
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!milestoneComposerTitle.trim() || !milestoneComposerProjectId.trim() || !milestoneComposerDate.trim()}
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
          <CompactButton onClick={() => setOpenedTeamId(contextMenu.teamId)}>Open team</CompactButton>
          <CompactButton onClick={() => openInviteForTeam(contextMenu.teamId)}>Invite member</CompactButton>
          <CompactButton
            onClick={() => {
              const team = teams.find((item) => item.id === contextMenu.teamId);
              if (team) void navigator.clipboard?.writeText(`${window.location.origin}/teams/${team.id}`).catch(() => undefined);
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
