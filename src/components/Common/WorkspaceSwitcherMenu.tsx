import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Copy,
  LogOut,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { buildInviteUrl } from '../../config/invite';
import { ModalOverlay } from './ModalOverlay';
import { ModalCloseButton } from './ModalCloseButton';
import { sidebarTheme } from '../Sidebar/sidebarTheme';

type WorkspaceSwitcherMenuProps = {
  variant?: 'header' | 'sidebar';
  compact?: boolean;
};

type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
type AppRegionStyle = CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

const menuWidth = 284;
const submenuWidth = 284;
const viewportPadding = 8;
const noDragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'no-drag' };

const getWorkspaceLabel = (workspace?: {
  is_personal?: boolean;
  role?: WorkspaceRole;
}) => {
  if (workspace?.is_personal) return 'Personal workspace';
  const role = String(workspace?.role ?? '').toLowerCase();
  if (role === 'owner' || role === 'admin') return 'Shared workspace · Manage access';
  return 'Shared workspace';
};

const getWorkspaceInitials = (name: string) => {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'W';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const triggerBaseClass =
  'inline-flex min-w-0 items-center gap-1.5 rounded-xl px-2 py-1 text-left text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20';

export const WorkspaceSwitcherMenu = ({ variant = 'sidebar', compact = false }: WorkspaceSwitcherMenuProps) => {
  const { signOut } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace, workspaces, setActiveWorkspace, refreshWorkspaces } =
    useWorkspaceContext();
  const api = useApi();
  const [isOpen, setIsOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [submenuStyle, setSubmenuStyle] = useState<CSSProperties | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState<'personal' | 'shared'>('shared');
  const [createDescription, setCreateDescription] = useState('');
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [workspaceTeams, setWorkspaceTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [workspaceLoadingTeams, setWorkspaceLoadingTeams] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const switchRowRef = useRef<HTMLButtonElement | null>(null);
  const submenuCloseTimerRef = useRef<number | null>(null);

  const resolvedWorkspace = activeWorkspace ?? workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const workspaceName = resolvedWorkspace?.name?.trim() || 'Workspace';
  const workspaceInitials = getWorkspaceInitials(workspaceName);

  const primaryButtonClass =
    variant === 'header'
      ? `${triggerBaseClass} ${compact ? 'max-w-56' : 'max-w-60'} text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]`
      : `${triggerBaseClass} ${compact ? 'max-w-52' : 'max-w-56'} px-0 text-[var(--ledger-text-secondary)]`;

  const openSettingsSection = (focusSection: 'account' | 'workspace' | 'integrations' | 'sidebar') => {
    void window.desktopWindow?.openModule('settings', {
      kind: 'settings',
      focusSection,
    });
  };

  const closeAllMenus = () => {
    setIsOpen(false);
    setSubmenuOpen(false);
  };

  const updateMenuPosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding));
    const top = Math.max(viewportPadding, Math.min(rect.bottom + 6, window.innerHeight - 320));

    setMenuStyle({
      position: 'fixed',
      left,
      top,
      width: menuWidth,
      zIndex: 9999,
    });
  };

  const updateSubmenuPosition = () => {
    const menuRect = menuRef.current?.getBoundingClientRect();
    const switchRect = switchRowRef.current?.getBoundingClientRect();
    if (!menuRect || !switchRect) return;

    const canOpenRight = menuRect.right + submenuWidth + 12 <= window.innerWidth - viewportPadding;
    const left = canOpenRight
      ? Math.min(menuRect.right + 8, window.innerWidth - submenuWidth - viewportPadding)
      : Math.max(viewportPadding, menuRect.left - submenuWidth - 8);
    const top = Math.max(viewportPadding, Math.min(switchRect.top, window.innerHeight - 360));

    setSubmenuStyle({
      position: 'fixed',
      left,
      top,
      width: submenuWidth,
      zIndex: 10000,
    });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAllMenus();
      }
    };

    updateMenuPosition();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!submenuOpen) return;

    updateSubmenuPosition();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAllMenus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updateSubmenuPosition);
    window.addEventListener('scroll', updateSubmenuPosition, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updateSubmenuPosition);
      window.removeEventListener('scroll', updateSubmenuPosition, true);
    };
  }, [submenuOpen]);

  useEffect(() => {
    return () => {
      if (submenuCloseTimerRef.current !== null) {
        window.clearTimeout(submenuCloseTimerRef.current);
        submenuCloseTimerRef.current = null;
      }
    };
  }, []);

  const loadWorkspaceTeams = async () => {
    if (!activeWorkspaceId) return;
    setWorkspaceLoadingTeams(true);
    try {
      const payload = await api.getTeams({ includeArchived: false });
      const teams = Array.isArray((payload as { teams?: unknown[] })?.teams)
        ? ((payload as { teams: Array<{ id: string; name: string }> }).teams ?? [])
        : [];
      setWorkspaceTeams(teams.map((team) => ({ id: team.id, name: team.name })));
    } catch {
      setWorkspaceTeams([]);
    } finally {
      setWorkspaceLoadingTeams(false);
    }
  };

  const openMenu = async () => {
    updateMenuPosition();
    setIsOpen(true);
    setSubmenuOpen(false);
    setInviteModalOpen(false);
    setCreateModalOpen(false);
    if (workspaceTeams.length === 0 && !workspaceLoadingTeams) {
      void loadWorkspaceTeams();
    }
  };

  const openInviteModal = async () => {
    setCreateModalOpen(false);
    setInviteModalOpen(true);
    setInviteEmail('');
    setInviteRole('member');
    setInviteLink(null);
    setInviteStatus(null);
    if (workspaceTeams.length === 0 && !workspaceLoadingTeams) {
      void loadWorkspaceTeams();
    }
  };

  const handleCreateWorkspace = async () => {
    const name = createName.trim();
    if (!name) {
      setCreateStatus('Workspace name is required.');
      return;
    }

    setIsCreatingWorkspace(true);
    setCreateStatus(null);
    try {
      const payload = (await api.createWorkspace({
        name,
        description: createDescription.trim() || null,
        is_personal: createType === 'personal',
      })) as { workspace_id?: string; id?: string };
      const workspaceId = String(payload?.workspace_id ?? payload?.id ?? '').trim();
      if (workspaceId) {
        await setActiveWorkspace(workspaceId);
        await refreshWorkspaces();
      }
      setCreateStatus('Workspace created.');
      setCreateModalOpen(false);
      closeAllMenus();
    } catch (error) {
      setCreateStatus(error instanceof Error ? error.message : 'Could not create workspace.');
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleSendInvite = async () => {
    if (!activeWorkspaceId) return;
    const email = inviteEmail.trim();
    if (!email) {
      setInviteStatus('Email address is required.');
      return;
    }

    setIsSendingInvite(true);
    setInviteStatus(null);
    try {
      const response = (await api.createWorkspaceInvitation(activeWorkspaceId, {
        email,
        role: inviteRole,
      })) as { invite_url?: string; invite_token?: string };
      const inviteUrl = response.invite_url ?? (response.invite_token ? buildInviteUrl(response.invite_token) : null);
      setInviteLink(inviteUrl);
      setInviteStatus('Invite created.');
      await loadWorkspaceTeams();
    } catch (error) {
      setInviteStatus(error instanceof Error ? error.message : 'Could not create invite.');
    } finally {
      setIsSendingInvite(false);
    }
  };

  const primaryMenuItems = [
    {
      label: 'Workspace settings',
      icon: Settings,
      action: () => {
        closeAllMenus();
        openSettingsSection('workspace');
      },
    },
    {
      label: 'Invite members',
      icon: UserPlus,
      action: () => {
        closeAllMenus();
        void openInviteModal();
      },
    },
    {
      label: 'Manage teams',
      icon: Users,
      action: () => {
        closeAllMenus();
        openSettingsSection('workspace');
      },
    },
  ];

  const selectWorkspace = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === activeWorkspaceId) {
      closeAllMenus();
      return;
    }

    try {
      await setActiveWorkspace(workspaceId);
    } finally {
      closeAllMenus();
    }
  };

  const menuButtonRows = menuRef.current
    ? Array.from(menuRef.current.querySelectorAll<HTMLElement>('[data-switcher-row="true"]'))
    : [];
  const submenuButtonRows = submenuRef.current
    ? Array.from(submenuRef.current.querySelectorAll<HTMLElement>('[data-switcher-subrow="true"]'))
    : [];

  const handlePrimaryKeyDown = (event: ReactKeyboardEvent) => {
    const items = menuButtonRows;
    if (items.length === 0) return;

    const activeIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = items[Math.min(items.length - 1, Math.max(0, activeIndex + 1))] ?? items[0];
      next.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = items[Math.max(0, activeIndex - 1)] ?? items[items.length - 1];
      next.focus();
    } else if (event.key === 'ArrowRight') {
      if (document.activeElement === switchRowRef.current) {
        event.preventDefault();
        setSubmenuOpen(true);
        window.setTimeout(() => {
          submenuRef.current
            ?.querySelector<HTMLElement>('[data-switcher-subrow="true"]')
            ?.focus();
        }, 0);
      }
    }
  };

  const handleSubmenuKeyDown = (event: ReactKeyboardEvent) => {
    const items = submenuButtonRows;
    if (items.length === 0) return;

    const activeIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = items[Math.min(items.length - 1, Math.max(0, activeIndex + 1))] ?? items[0];
      next.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = items[Math.max(0, activeIndex - 1)] ?? items[items.length - 1];
      next.focus();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSubmenuOpen(false);
      window.setTimeout(() => switchRowRef.current?.focus(), 0);
    }
  };

  return (
    <>
      <div className="relative inline-flex" style={noDragRegionStyle}>
        <button
          ref={buttonRef}
          type="button"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={async (event) => {
            event.stopPropagation();
            if (isOpen) {
              closeAllMenus();
            } else {
              await openMenu();
            }
          }}
          onMouseDown={(event) => event.stopPropagation()}
          title={workspaceName}
          aria-label={`Switch workspace. Current workspace: ${workspaceName}`}
          aria-expanded={isOpen}
          className={primaryButtonClass}
        >
          <span
            className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-md bg-[color:rgba(255,95,64,0.12)] px-1 text-[10px] font-semibold text-[var(--ledger-accent)]"
            aria-hidden="true"
          >
            {workspaceInitials}
          </span>
          <span className="min-w-0 truncate">{workspaceName}</span>
          <ChevronDown size={12} className="shrink-0 text-[var(--ledger-text-muted)]" />
        </button>
      </div>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[9998] pointer-events-auto"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeAllMenus();
                }
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div
                ref={menuRef}
                role="menu"
                aria-label="Workspace menu"
                style={menuStyle ?? undefined}
                className={`${sidebarTheme.menu} max-h-[calc(100vh-16px)] overflow-x-hidden overflow-y-auto py-1 shadow-[0_16px_48px_rgba(15,23,42,0.14)] ring-0 outline-none`}
                onKeyDown={handlePrimaryKeyDown}
                onMouseDown={(event) => event.stopPropagation()}
                onMouseMove={(event) => event.stopPropagation()}
                onMouseEnter={(event) => event.stopPropagation()}
                onMouseLeave={() => {
                  if (submenuCloseTimerRef.current !== null) {
                    window.clearTimeout(submenuCloseTimerRef.current);
                  }
                  submenuCloseTimerRef.current = window.setTimeout(() => {
                    setSubmenuOpen(false);
                  }, 140);
                }}
              >
                <div className="p-1">
                  {primaryMenuItems.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        data-switcher-row="true"
                        onClick={item.action}
                        className="flex min-h-9 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
                      >
                        <ItemIcon size={14} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </button>
                    );
                  })}

                  <button
                    ref={switchRowRef}
                    type="button"
                    data-switcher-row="true"
                    onClick={() => setSubmenuOpen((current) => !current)}
                    onMouseEnter={() => {
                      if (submenuCloseTimerRef.current !== null) {
                        window.clearTimeout(submenuCloseTimerRef.current);
                      }
                      setSubmenuOpen(true);
                    }}
                    className="flex min-h-9 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
                  >
                    <ArrowRight size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">Switch workspace</span>
                    <ChevronRight size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                  </button>

                  <div className="my-1 border-t border-[color:var(--ledger-border-subtle)]" />

                  <button
                    type="button"
                    data-switcher-row="true"
                    onClick={() => {
                      closeAllMenus();
                      openSettingsSection('account');
                    }}
                    className="flex min-h-9 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
                  >
                    <CircleUserRound size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">Preferences</span>
                  </button>

                  <button
                    type="button"
                    data-switcher-row="true"
                    onClick={async () => {
                      closeAllMenus();
                      await signOut();
                    }}
                    className="flex min-h-9 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
                  >
                    <LogOut size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">Log out</span>
                  </button>
                </div>
              </div>

              {submenuOpen && (
                <div
                  ref={submenuRef}
                  role="menu"
                  aria-label="Switch workspace submenu"
                  style={submenuStyle ?? undefined}
                  className={`${sidebarTheme.menu} max-h-[calc(100vh-16px)] overflow-x-hidden overflow-y-auto py-1 shadow-[0_16px_48px_rgba(15,23,42,0.14)] ring-0 outline-none`}
                  onKeyDown={handleSubmenuKeyDown}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseEnter={() => {
                    if (submenuCloseTimerRef.current !== null) {
                      window.clearTimeout(submenuCloseTimerRef.current);
                    }
                    setSubmenuOpen(true);
                  }}
                  onMouseLeave={() => {
                    if (submenuCloseTimerRef.current !== null) {
                      window.clearTimeout(submenuCloseTimerRef.current);
                    }
                    submenuCloseTimerRef.current = window.setTimeout(() => {
                      setSubmenuOpen(false);
                    }, 140);
                  }}
                >
                  <div className="p-1">
                    {workspaces.map((workspace) => {
                      const isActive = workspace.id === activeWorkspaceId;
                      return (
                        <button
                          key={workspace.id}
                          type="button"
                          data-switcher-subrow="true"
                          onClick={() => void selectWorkspace(workspace.id)}
                          className={`flex min-h-9 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20 ${
                            isActive
                              ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                              : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                          }`}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[color:rgba(255,95,64,0.12)] text-[10px] font-semibold text-[var(--ledger-accent)]">
                            {getWorkspaceInitials(workspace.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{workspace.name}</span>
                            <span className="block truncate text-[11px] text-[var(--ledger-text-muted)]">
                              {getWorkspaceLabel(workspace)}
                            </span>
                          </span>
                        </button>
                      );
                    })}

                  </div>
                </div>
              )}
            </div>,
            document.body
          )
        : null}

      <ModalOverlay
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[440px] overflow-hidden rounded-[18px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">Invite members</p>
            <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
              Invite people to {workspaceName}.
            </p>
          </div>
          <ModalCloseButton onClick={() => setInviteModalOpen(false)} ariaLabel="Close invite modal" />
        </div>
        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">Email address</span>
            <input
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)]"
              placeholder="name@company.com"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">Role</span>
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as 'admin' | 'member')}
                className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">Team</span>
              <select
                disabled={workspaceLoadingTeams}
                className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] disabled:opacity-60"
              >
                <option value="">No team</option>
                {workspaceTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {inviteLink && (
            <div className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-secondary)]">
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ledger-text-muted)]">
                Invite link
              </p>
              <p className="mt-1 break-all text-sm text-[var(--ledger-text-primary)]">{inviteLink}</p>
              <button
                type="button"
                onClick={async () => {
                  if (!inviteLink) return;
                  try {
                    await navigator.clipboard.writeText(inviteLink);
                    setInviteStatus('Invite link copied.');
                  } catch {
                    setInviteStatus('Copy failed. Select the link manually.');
                  }
                }}
                className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              >
                <Copy size={12} />
                Copy link
              </button>
            </div>
          )}
          {inviteStatus && <p className="text-xs text-[var(--ledger-text-muted)]">{inviteStatus}</p>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={() => setInviteModalOpen(false)}
            className="inline-flex h-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSendInvite()}
            disabled={isSendingInvite}
            className="inline-flex h-8 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
          >
            {isSendingInvite ? 'Sending...' : 'Send invite'}
          </button>
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[440px] overflow-hidden rounded-[18px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">New workspace</p>
            <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
              Create a new personal or shared workspace.
            </p>
          </div>
          <ModalCloseButton onClick={() => setCreateModalOpen(false)} ariaLabel="Close new workspace modal" />
        </div>
        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">Workspace name</span>
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)]"
              placeholder="Design Ops"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">Type</span>
              <select
                value={createType}
                onChange={(event) => setCreateType(event.target.value as 'personal' | 'shared')}
                className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
              >
                <option value="shared">Shared</option>
                <option value="personal">Personal</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ledger-text-muted)]">Description</span>
              <input
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none transition placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)]"
                placeholder="Optional"
              />
            </label>
          </div>
          {createStatus && <p className="text-xs text-[var(--ledger-text-muted)]">{createStatus}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={() => setCreateModalOpen(false)}
            className="inline-flex h-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreateWorkspace()}
            disabled={isCreatingWorkspace}
            className="inline-flex h-8 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
          >
            {isCreatingWorkspace ? 'Creating...' : 'Create workspace'}
          </button>
        </div>
      </ModalOverlay>
    </>
  );
};
