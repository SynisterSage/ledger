import {
  ChevronLeft,
  Hash,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ModuleWindowHeader, ModuleHeaderActionButton } from '../Common/ModuleWindowHeader';
import { ModalOverlay } from '../Common/ModalOverlay';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';

type TeamMember = {
  id: string;
  name: string;
  email?: string | null;
  role: 'lead' | 'member' | 'viewer';
  initials: string;
};

type WorkspaceMemberPayload = {
  user_id: string;
  email?: string | null;
  full_name?: string | null;
  role?: string | null;
};

type TeamPayload = {
  id: string;
  name: string;
  identifier: string;
  description?: string | null;
  color?: string | null;
  members: TeamMember[];
  assignedCount: number;
  milestoneCount: number;
  currentUserRole?: 'lead' | 'member' | 'viewer' | null;
  archivedAt?: string | null;
  defaultTaskScope?: 'long_term' | 'today';
  defaultProjectVisibility?: 'workspace' | 'team';
  defaultAssigneeBehavior?: 'team' | 'lead';
};

const teamColors = ['#FF5F40', '#D97706', '#0F766E', '#2563EB', '#7C3AED', '#475569'];

const settingsTheme = {
  shell:
    'relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none',
  content: 'flex-1 min-h-0 overflow-auto bg-[var(--ledger-background)] px-6 py-7',
  page: 'mx-auto flex min-h-full w-full max-w-4xl flex-col gap-7',
  pageTitle: 'text-[32px] font-normal leading-tight tracking-tight text-[var(--ledger-text-primary)]',
  subtitle: 'text-sm font-light text-[var(--ledger-text-muted)]',
  status: 'text-xs text-[var(--ledger-text-muted)]',
  section:
    'rounded-[22px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]',
  sectionHeader: 'flex items-center justify-between gap-4 px-4 pt-4',
  sectionTitle: 'text-sm font-medium text-[var(--ledger-text-primary)]',
  sectionHelp: 'text-xs text-[var(--ledger-text-muted)]',
  rows: 'mt-4 divide-y divide-[color:var(--ledger-border-subtle)] border-t border-[color:var(--ledger-border-subtle)]',
  row: 'grid gap-3 px-4 py-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-center',
  memberRow: 'grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_148px_auto] md:items-center',
  label: 'text-sm font-medium text-[var(--ledger-text-secondary)]',
  value: 'text-sm text-[var(--ledger-text-primary)]',
  muted: 'text-xs text-[var(--ledger-text-muted)]',
  input:
    'h-10 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60',
  textarea:
    'min-h-24 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60',
  control:
    'inline-flex h-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-60',
  primary:
    'inline-flex h-8 items-center justify-center rounded-full border border-[color:var(--ledger-accent)] bg-[var(--ledger-accent)] px-3 text-xs font-semibold text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60',
  danger:
    'inline-flex h-8 items-center justify-center rounded-full border border-[color:rgba(217,45,32,0.18)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)] disabled:opacity-60',
  chip:
    'inline-flex items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)]',
};

const getInitials = (name: string, email?: string | null) => {
  const source = name.trim() || email?.split('@')[0] || 'Member';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const TeamBadge = ({ color }: { color: string }) => (
  <span
    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
    style={{ backgroundColor: color }}
  >
    <Hash size={14} />
  </span>
);

const TeamSettingsWindow = ({ focusContext }: { focusContext?: string }) => {
  const api = useApi();
  const { user } = useAuthContext();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceContext();
  const workspaceName = activeWorkspace?.name?.trim() || 'Workspace';
  const teamId = useMemo(() => {
    const raw = String(focusContext ?? '').trim();
    if (!raw) return null;
    if (raw.startsWith('team-settings:')) {
      return raw.slice('team-settings:'.length).trim() || null;
    }
    if (raw.startsWith('team:')) {
      return raw.slice('team:'.length).trim() || null;
    }
    return null;
  }, [focusContext]);

  const [teams, setTeams] = useState<TeamPayload[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberPayload[]>([]);
  const [workspaceRole, setWorkspaceRole] = useState<'owner' | 'admin' | 'member' | 'viewer'>('member');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberRole, setMemberRole] = useState<'lead' | 'member' | 'viewer'>('member');
  const [memberActionId, setMemberActionId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const [draftName, setDraftName] = useState('');
  const [draftIdentifier, setDraftIdentifier] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftColor, setDraftColor] = useState(teamColors[0]);
  const [draftTaskScope, setDraftTaskScope] = useState<'long_term' | 'today'>('long_term');
  const [draftProjectVisibility, setDraftProjectVisibility] = useState<'workspace' | 'team'>('workspace');
  const [draftAssigneeBehavior, setDraftAssigneeBehavior] = useState<'team' | 'lead'>('team');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeWorkspaceId) {
        setTeams([]);
        setWorkspaceMembers([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const [teamsPayload, membersPayload] = await Promise.all([
          api.getTeams({ includeArchived: true }),
          api.getWorkspaceMembers(activeWorkspaceId),
        ]);

        if (cancelled) return;

        const nextTeams = Array.isArray((teamsPayload as { teams?: unknown[] })?.teams)
          ? ((teamsPayload as { teams: TeamPayload[] }).teams ?? [])
          : [];
        const nextMembers = Array.isArray((membersPayload as { members?: unknown[] })?.members)
          ? ((membersPayload as { members: WorkspaceMemberPayload[] }).members ?? [])
          : [];

        setTeams(nextTeams);
        setWorkspaceMembers(nextMembers);

        const workspaceRoleCandidate = String(
          (teamsPayload as { current_user_role?: string })?.current_user_role ?? 'member'
        ).toLowerCase();
        if (workspaceRoleCandidate === 'owner' || workspaceRoleCandidate === 'admin' || workspaceRoleCandidate === 'member' || workspaceRoleCandidate === 'viewer') {
          setWorkspaceRole(workspaceRoleCandidate);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load team settings');
          setTeams([]);
          setWorkspaceMembers([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api]);

  const team = useMemo(() => teams.find((item) => item.id === teamId) ?? null, [teamId, teams]);
  const isArchived = Boolean(team?.archivedAt);
  const canManageTeam =
    workspaceRole === 'owner' || workspaceRole === 'admin' || team?.currentUserRole === 'lead';

  useEffect(() => {
    if (!team) return;
    setDraftName(team.name);
    setDraftIdentifier(team.identifier);
    setDraftDescription(team.description ?? '');
    setDraftColor(team.color ?? teamColors[0]);
    setDraftTaskScope(team.defaultTaskScope ?? 'long_term');
    setDraftProjectVisibility(team.defaultProjectVisibility ?? 'workspace');
    setDraftAssigneeBehavior(team.defaultAssigneeBehavior ?? 'team');
    setSaveStatus(null);
  }, [team]);

  const originalSnapshot = useMemo(
    () =>
      team
        ? {
            name: team.name,
            identifier: team.identifier,
            description: team.description ?? '',
            color: team.color ?? teamColors[0],
            taskScope: team.defaultTaskScope ?? 'long_term',
            projectVisibility: team.defaultProjectVisibility ?? 'workspace',
            assigneeBehavior: team.defaultAssigneeBehavior ?? 'team',
          }
        : null,
    [team]
  );

  const isDirty = Boolean(
    originalSnapshot &&
      (draftName !== originalSnapshot.name ||
        draftIdentifier !== originalSnapshot.identifier ||
        draftDescription !== originalSnapshot.description ||
        draftColor !== originalSnapshot.color ||
        draftTaskScope !== originalSnapshot.taskScope ||
        draftProjectVisibility !== originalSnapshot.projectVisibility ||
        draftAssigneeBehavior !== originalSnapshot.assigneeBehavior)
  );

  const addableMembers = useMemo(() => {
    const existingIds = new Set((team?.members ?? []).map((member) => member.id));
    const needle = memberSearch.trim().toLowerCase();
    return workspaceMembers
      .filter((member) => !existingIds.has(member.user_id))
      .filter((member) => {
        if (!needle) return true;
        const haystack = [member.full_name, member.email, member.user_id].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(needle);
      })
      .map((member) => ({
        user_id: member.user_id,
        name: member.full_name?.trim() || member.email?.split('@')[0] || 'Workspace member',
        email: member.email ?? null,
        initials: getInitials(member.full_name?.trim() || '', member.email ?? null),
      }));
  }, [memberSearch, team?.members, workspaceMembers]);

  const reload = async () => {
    if (!activeWorkspaceId) return;
    const [teamsPayload, membersPayload] = await Promise.all([
      api.getTeams({ includeArchived: true }),
      api.getWorkspaceMembers(activeWorkspaceId),
    ]);
    const nextTeams = Array.isArray((teamsPayload as { teams?: unknown[] })?.teams)
      ? ((teamsPayload as { teams: TeamPayload[] }).teams ?? [])
      : [];
    const nextMembers = Array.isArray((membersPayload as { members?: unknown[] })?.members)
      ? ((membersPayload as { members: WorkspaceMemberPayload[] }).members ?? [])
      : [];
    setTeams(nextTeams);
    setWorkspaceMembers(nextMembers);
  };

  const saveTeam = async () => {
    if (!team) return;
    const name = draftName.trim();
    const identifier = draftIdentifier.trim().toUpperCase();
    if (!name) {
      setError('Team name is required.');
      return;
    }
    if (!identifier) {
      setError('Identifier is required.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaveStatus(null);
    try {
      await api.updateTeam(team.id, {
        name,
        identifier,
        description: draftDescription.trim() || null,
        color: draftColor,
        default_task_scope: draftTaskScope,
        default_project_visibility: draftProjectVisibility,
        default_assignee_behavior: draftAssigneeBehavior,
      });
      await reload();
      setSaveStatus('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save team');
    } finally {
      setIsSaving(false);
    }
  };

  const updateMemberRole = async (userId: string, role: 'lead' | 'member' | 'viewer') => {
    if (!team || !canManageTeam) return;
    setMemberActionId(userId);
    setError(null);
    try {
      await api.addTeamMember(team.id, { user_id: userId, role });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update team member');
    } finally {
      setMemberActionId(null);
    }
  };

  const removeMember = async (userId: string) => {
    if (!team || !canManageTeam) return;
    setMemberActionId(userId);
    setError(null);
    try {
      await api.removeTeamMember(team.id, userId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove team member');
    } finally {
      setMemberActionId(null);
    }
  };

  const addMember = async (userId: string) => {
    if (!team || !canManageTeam) return;
    setMemberActionId(userId);
    setError(null);
    try {
      await api.addTeamMember(team.id, { user_id: userId, role: memberRole });
      await reload();
      setIsAddMemberOpen(false);
      setMemberSearch('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add team member');
    } finally {
      setMemberActionId(null);
    }
  };

  const archiveTeam = async () => {
    if (!team || !canManageTeam) return;
    setArchiveBusy(true);
    setError(null);
    try {
      if (isArchived) {
        await api.restoreTeam(team.id);
      } else {
        await api.archiveTeam(team.id);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update team archive state');
    } finally {
      setArchiveBusy(false);
    }
  };

  const deleteTeam = async () => {
    if (!team || !canManageTeam) return;
    if (deleteConfirm.trim() !== team.name.trim()) {
      setError(`Type ${team.name} to confirm deletion.`);
      return;
    }
    setArchiveBusy(true);
    setError(null);
    try {
      await api.deleteTeam(team.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete team');
    } finally {
      setArchiveBusy(false);
      setIsDeleteOpen(false);
    }
  };

  const openWorkSurface = () => {
    if (!team) return;
    void window.desktopWindow?.openModule('teams', {
      kind: 'teams',
      focusContext: `team:${team.id}`,
    } as any);
  };

  if (!activeWorkspaceId) {
    return (
      <div className={settingsTheme.shell}>
        <ModuleWindowHeader
          title="Team settings"
          subtitle="Select a workspace first."
          icon={<Users size={18} />}
          compact
          onClose={() => window.desktopWindow?.closeModule('teams')}
        />
        <div className={settingsTheme.content}>
          <div className={settingsTheme.page}>
            <p className={settingsTheme.subtitle}>No active workspace selected.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!teamId) {
    return (
      <div className={settingsTheme.shell}>
        <ModuleWindowHeader
          title="Team settings"
          subtitle={workspaceName}
          icon={<Users size={18} />}
          compact
          onClose={() => window.desktopWindow?.closeModule('teams')}
        />
        <div className={settingsTheme.content}>
          <div className={settingsTheme.page}>
            <p className={settingsTheme.subtitle}>No team selected.</p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={settingsTheme.shell}>
        <ModuleWindowHeader
          title="Team settings"
          subtitle={workspaceName}
          icon={<Users size={18} />}
          compact
          onClose={() => window.desktopWindow?.closeModule('teams')}
        />
        <div className={settingsTheme.content}>
          <div className={settingsTheme.page}>
            <p className={settingsTheme.subtitle}>Loading team…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className={settingsTheme.shell}>
        <ModuleWindowHeader
          title="Team settings"
          subtitle={workspaceName}
          icon={<Users size={18} />}
          compact
          onClose={() => window.desktopWindow?.closeModule('teams')}
        />
        <div className={settingsTheme.content}>
          <div className={settingsTheme.page}>
            <p className={settingsTheme.subtitle}>This team no longer exists.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={settingsTheme.shell}>
      <ModuleWindowHeader
        title="Team settings"
        subtitle={team.name}
        icon={<Users size={18} />}
        compact
        onClose={() => window.desktopWindow?.closeModule('teams')}
        primaryActions={
          <ModuleHeaderActionButton
            title="Open team"
            ariaLabel="Open team"
            icon={<ChevronLeft size={14} />}
            onClick={openWorkSurface}
            variant="strip"
          >
            Open team
          </ModuleHeaderActionButton>
        }
      />

      <div className={settingsTheme.content}>
        <div className={settingsTheme.page}>
          <header className="space-y-2">
            <div className="flex items-center gap-3">
              <TeamBadge color={team.color ?? teamColors[0]} />
              <div className="min-w-0">
                <h1 className={settingsTheme.pageTitle}>{team.name}</h1>
                <p className={settingsTheme.subtitle}>
                  {team.members.length} members · {workspaceName}
                </p>
              </div>
            </div>
            <p className={settingsTheme.status} role="status">
              {saveStatus || error || (isArchived ? 'Archived team.' : 'Changes save when you click Save changes.')}
            </p>
          </header>

          <section className={settingsTheme.section} aria-labelledby="team-general">
            <div className={settingsTheme.sectionHeader}>
              <div>
                <h2 id="team-general" className={settingsTheme.sectionTitle}>
                  General
                </h2>
                <p className={settingsTheme.sectionHelp}>Manage the team’s visible details.</p>
              </div>
              <span className={settingsTheme.chip}>
                {team.assignedCount} assigned · {team.milestoneCount} milestones
              </span>
            </div>
            <div className={settingsTheme.rows}>
              <div className={settingsTheme.row}>
                <div className={settingsTheme.label}>Team name</div>
                <input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  className={settingsTheme.input}
                  disabled={!canManageTeam}
                />
              </div>
              <div className={settingsTheme.row}>
                <div className={settingsTheme.label}>Description</div>
                <textarea
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  placeholder="Optional short description"
                  className={settingsTheme.input}
                  disabled={!canManageTeam}
                />
              </div>
              <div className={settingsTheme.row}>
                <div className={settingsTheme.label}>Color</div>
                <div className="flex flex-wrap gap-2">
                  {teamColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setDraftColor(color)}
                      disabled={!canManageTeam}
                      className={`h-7 w-7 rounded-full border-2 transition ${
                        draftColor === color ? 'border-[var(--ledger-text-primary)]' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`Use ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className={settingsTheme.row}>
                <div className={settingsTheme.label}>Save</div>
                <div className="flex justify-end">
                  <button type="button" onClick={saveTeam} disabled={!canManageTeam || !isDirty || isSaving} className={settingsTheme.primary}>
                    {isSaving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className={settingsTheme.section} aria-labelledby="team-identifier">
            <div className={settingsTheme.sectionHeader}>
              <div>
                <h2 id="team-identifier" className={settingsTheme.sectionTitle}>
                  Identifier
                </h2>
                <p className={settingsTheme.sectionHelp}>Used in team views and assigned work.</p>
              </div>
            </div>
            <div className={settingsTheme.rows}>
              <div className={settingsTheme.row}>
                <div className={settingsTheme.label}>Identifier</div>
                <input
                  value={draftIdentifier}
                  onChange={(event) => setDraftIdentifier(event.target.value.toUpperCase())}
                  className={settingsTheme.input}
                  disabled={!canManageTeam}
                />
              </div>
            </div>
          </section>

          <section className={settingsTheme.section} aria-labelledby="team-members">
            <div className={settingsTheme.sectionHeader}>
              <div>
                <h2 id="team-members" className={settingsTheme.sectionTitle}>
                  Members
                </h2>
                <p className={settingsTheme.sectionHelp}>Manage who belongs to this team.</p>
              </div>
              <button type="button" onClick={() => setIsAddMemberOpen(true)} disabled={!canManageTeam} className={settingsTheme.control}>
                <Plus size={12} />
                Add member
              </button>
            </div>
            <div className={settingsTheme.rows}>
              {team.members.length === 0 ? (
                <div className="px-4 py-5 text-sm text-[var(--ledger-text-muted)]">No members yet.</div>
              ) : (
                team.members.map((member) => {
                  const canEdit = canManageTeam && member.id !== user?.id;
                  return (
                    <div key={member.id} className={settingsTheme.memberRow}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--ledger-text-primary)]">{member.name}</p>
                        <p className="truncate text-xs text-[var(--ledger-text-muted)]">{member.email || 'No email'}</p>
                      </div>
                      <select
                        value={member.role}
                        onChange={(event) => void updateMemberRole(member.id, event.target.value as TeamMember['role'])}
                        disabled={!canEdit || memberActionId === member.id}
                        className={settingsTheme.input}
                      >
                        <option value="lead">Lead</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void removeMember(member.id)}
                        disabled={!canEdit || memberActionId === member.id}
                        className={settingsTheme.control}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className={settingsTheme.section} aria-labelledby="team-defaults">
            <div className={settingsTheme.sectionHeader}>
              <div>
                <h2 id="team-defaults" className={settingsTheme.sectionTitle}>
                  Assignment defaults
                </h2>
                <p className={settingsTheme.sectionHelp}>Choose how work created from this team behaves.</p>
              </div>
            </div>
            <div className={settingsTheme.rows}>
              <div className={settingsTheme.row}>
                <div className={settingsTheme.label}>Default task scope</div>
                <select
                  value={draftTaskScope}
                  onChange={(event) => setDraftTaskScope(event.target.value as 'long_term' | 'today')}
                  disabled={!canManageTeam}
                  className={settingsTheme.input}
                >
                  <option value="long_term">Long-term</option>
                  <option value="today">Today</option>
                </select>
              </div>
              <div className={settingsTheme.row}>
                <div className={settingsTheme.label}>Default project visibility</div>
                <select
                  value={draftProjectVisibility}
                  onChange={(event) => setDraftProjectVisibility(event.target.value as 'workspace' | 'team')}
                  disabled={!canManageTeam}
                  className={settingsTheme.input}
                >
                  <option value="workspace">Workspace</option>
                  <option value="team">Team only</option>
                </select>
              </div>
              <div className={settingsTheme.row}>
                <div className={settingsTheme.label}>Default assignee behavior</div>
                <select
                  value={draftAssigneeBehavior}
                  onChange={(event) => setDraftAssigneeBehavior(event.target.value as 'team' | 'lead')}
                  disabled={!canManageTeam}
                  className={settingsTheme.input}
                >
                  <option value="team">Assign to team</option>
                  <option value="lead">Assign to team lead</option>
                </select>
              </div>
            </div>
          </section>

          <section className={settingsTheme.section} aria-labelledby="team-danger">
            <div className={settingsTheme.sectionHeader}>
              <div>
                <h2 id="team-danger" className={settingsTheme.sectionTitle}>
                  Danger zone
                </h2>
                <p className={settingsTheme.sectionHelp}>Archive or delete this team.</p>
              </div>
            </div>
            <div className={settingsTheme.rows}>
              <div className={settingsTheme.row}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
                    {isArchived ? 'Restore team' : 'Archive team'}
                  </p>
                  <p className={settingsTheme.muted}>
                    {isArchived
                      ? 'Bring this team back into active lists.'
                      : 'Hide this team from active lists while preserving history.'}
                  </p>
                </div>
                <button type="button" onClick={() => void archiveTeam()} disabled={!canManageTeam || archiveBusy} className={settingsTheme.control}>
                  {archiveBusy ? 'Working...' : isArchived ? 'Restore' : 'Archive'}
                </button>
              </div>
              <div className={settingsTheme.row}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--ledger-danger)]">Delete team</p>
                  <p className={settingsTheme.muted}>
                    Reassign work before deleting. This cannot be undone.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirm('');
                    setIsDeleteOpen(true);
                  }}
                  disabled={!canManageTeam || archiveBusy}
                  className={settingsTheme.danger}
                >
                  Delete
                </button>
              </div>
            </div>
          </section>

          <section className={settingsTheme.section} aria-labelledby="team-work">
            <div className={settingsTheme.sectionHeader}>
              <div>
                <h2 id="team-work" className={settingsTheme.sectionTitle}>
                  Assigned work
                </h2>
                <p className={settingsTheme.sectionHelp}>This stays on the team work surface.</p>
              </div>
              <button type="button" onClick={openWorkSurface} className={settingsTheme.control}>
                View work
              </button>
            </div>
          </section>
        </div>
      </div>

      <ModalOverlay
        isOpen={isAddMemberOpen}
        onClose={() => setIsAddMemberOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-md rounded-2xl border p-5"
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium text-[var(--ledger-text-primary)]">Add member to {team.name}</h2>
            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">Search workspace members.</p>
          </div>
          <label className="flex h-9 items-center gap-2 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3">
            <Search size={14} className="text-[var(--ledger-text-muted)]" />
            <input
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder="Search workspace members..."
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
              autoFocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className={settingsTheme.label}>Role</span>
            <select value={memberRole} onChange={(event) => setMemberRole(event.target.value as TeamMember['role'])} className={settingsTheme.input}>
              <option value="lead">Lead</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <div className="max-h-64 space-y-1 overflow-auto">
            {addableMembers.length > 0 ? (
              addableMembers.map((member) => (
                <button
                  key={member.user_id}
                  type="button"
                  onClick={() => void addMember(member.user_id)}
                  disabled={memberActionId === member.user_id}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[10px] font-semibold text-[var(--ledger-text-secondary)]">
                    {member.initials}
                  </span>
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
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-md rounded-2xl border p-5"
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium text-[var(--ledger-text-primary)]">Delete {team.name}?</h2>
            <p className="mt-1 text-sm text-[var(--ledger-text-muted)]">
              Assigned work must be reassigned before deleting this team.
            </p>
          </div>
          <label className="block space-y-1.5">
            <span className={settingsTheme.label}>Type {team.name} to confirm</span>
            <input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} className={settingsTheme.input} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setIsDeleteOpen(false)} className={settingsTheme.control}>
              Cancel
            </button>
            <button type="button" onClick={() => void deleteTeam()} className={settingsTheme.danger}>
              Delete team
            </button>
          </div>
        </div>
      </ModalOverlay>
    </div>
  );
};

export default TeamSettingsWindow;
