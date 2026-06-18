import {
  type ReactNode,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, Maximize2, Minus, RefreshCw, X } from 'lucide-react';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { sidebarTheme } from '../Sidebar/sidebarTheme';

type ModuleWindowHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  onClose: () => void;
  onMinimize?: () => void;
  onToggleFullscreen?: () => void;
  closeLabel?: string;
  minimizeLabel?: string;
  fullscreenLabel?: string;
  showPanelToggle?: boolean;
  panelToggleLabel?: string;
  onTogglePanels?: () => void;
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  viewControls?: ReactNode;
  syncStatus?: ReactNode;
  globalActions?: ReactNode;
  stripActions?: ReactNode;
  actions?: ReactNode;
};

type ModuleHeaderActionButtonProps = {
  children: ReactNode;
  onClick: () => void;
  title: string;
  ariaLabel?: string;
  iconOnly?: boolean;
  active?: boolean;
  disabled?: boolean;
};

type ModuleHeaderSegmentedGroupProps = {
  children: ReactNode;
};

type ModuleHeaderSegmentedButtonProps = {
  children: ReactNode;
  onClick: () => void;
  title: string;
  ariaLabel?: string;
  active?: boolean;
  iconOnly?: boolean;
  pill?: boolean;
};

type ModuleHeaderStatusProps = {
  label: string;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  state?: 'synced' | 'syncing' | 'offline' | 'error';
};

type ModuleHeaderCounterActionProps = {
  label: string;
  icon: ReactNode;
  count: number;
  onClick: () => void;
  title: string;
  ariaLabel: string;
};

type ModuleHeaderStripActionProps = {
  icon: ReactNode;
  count?: number;
  onClick: () => void;
  title: string;
  ariaLabel: string;
};

const WorkspaceSwitcher = () => {
  const { activeWorkspaceId, activeWorkspace, workspaces, setActiveWorkspace, isLoading } =
    useWorkspaceContext();
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const resolvedLabel = useMemo(
    () => activeWorkspace?.name?.trim() || 'Workspace',
    [activeWorkspace?.name]
  );

  useEffect(() => {
    if (!isOpen) return;

    const updateMenuPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const menuWidth = 240;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
      const top = Math.min(rect.bottom + 4, window.innerHeight - 8);

      setMenuStyle({
        position: 'fixed',
        left,
        top,
        width: menuWidth,
        zIndex: 9999,
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
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

  if (isLoading || workspaces.length === 0) {
    return (
      <button
        type="button"
        disabled
        title="No workspaces available"
        aria-label="No workspaces available"
        className={`inline-flex h-7 min-w-28 max-w-60 items-center gap-1.5 text-left text-xs font-medium opacity-70 ${sidebarTheme.textMuted}`}
        style={noDragRegionStyle}
      >
        <span className="min-w-0 flex-1 truncate">Workspace</span>
        <ChevronDown size={13} className={`shrink-0 ${sidebarTheme.textMuted}`} />
      </button>
    );
  }

  return (
    <div className="relative" style={noDragRegionStyle}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        title={resolvedLabel}
        aria-label={`Switch workspace. Current workspace: ${resolvedLabel}`}
        className={`inline-flex h-7 min-w-28 max-w-60 items-center gap-1.5 text-left text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20 ${
          isOpen ? sidebarTheme.textPrimary : `${sidebarTheme.textSecondary} hover:${sidebarTheme.textPrimary}`
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{resolvedLabel}</span>
        <ChevronDown size={13} className={`shrink-0 ${sidebarTheme.textMuted}`} />
      </button>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-9998 pointer-events-auto"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setIsOpen(false);
                }
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div
                ref={menuRef}
                style={menuStyle ?? undefined}
                className={`${sidebarTheme.menu} max-h-60 overflow-y-auto shadow-[0_16px_48px_rgba(15,23,42,0.14)] ring-0 outline-none`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onMouseMove={(event) => event.stopPropagation()}
                onMouseEnter={(event) => event.stopPropagation()}
                onMouseLeave={(event) => event.stopPropagation()}
              >
                <div className="space-y-1 p-1.5" style={noDragRegionStyle}>
                  {workspaces.map((workspace) => {
                    const isActive = workspace.id === activeWorkspaceId;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={async (event) => {
                          event.stopPropagation();
                          try {
                            if (!isActive) {
                              await setActiveWorkspace(workspace.id);
                            }
                          } catch {
                            // Keep current workspace if switch fails.
                          } finally {
                            setIsOpen(false);
                          }
                        }}
                        className={`group flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20 ${
                          isActive
                            ? sidebarTheme.hoverSurface + ' ' + sidebarTheme.textPrimary
                            : `${sidebarTheme.textSecondary} hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary}`
                        }`}
                        style={noDragRegionStyle}
                        aria-current={isActive ? 'true' : undefined}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            isActive ? 'bg-[var(--ledger-accent)]' : 'bg-[var(--ledger-border-strong)]'
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};

type AppRegionStyle = CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

const dragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'drag' };
const noDragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'no-drag' };
const actionButtonClassName =
  `inline-flex h-9 items-center justify-center gap-1.5 rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} px-3.5 text-xs font-medium ${sidebarTheme.textSecondary} transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20`;

const iconButtonClassName =
  `inline-flex h-9 w-9 items-center justify-center rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} ${sidebarTheme.textSecondary} transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20`;

const segmentedGroupClassName =
  `inline-flex h-9 items-center rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.hoverSurface} p-0.5`;

const segmentedButtonBaseClassName =
  'inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20';

export const ModuleHeaderActionButton = ({
  children,
  onClick,
  title,
  ariaLabel,
  iconOnly = false,
  active = false,
  disabled = false,
}: ModuleHeaderActionButtonProps) => {
  const resolvedClassName = iconOnly ? iconButtonClassName : actionButtonClassName;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? title}
      className={`${resolvedClassName} ${
        disabled
          ? `cursor-not-allowed ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} ${sidebarTheme.textMuted} hover:${sidebarTheme.mutedSurface} hover:${sidebarTheme.textMuted}`
          : ''
      }`}
    >
      {children}
      {!iconOnly && active && (
        <span className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-[var(--ledger-accent)]" />
      )}
    </button>
  );
};

export const ModuleHeaderSegmentedGroup = ({ children }: ModuleHeaderSegmentedGroupProps) => {
  return <div className={segmentedGroupClassName}>{children}</div>;
};

export const ModuleHeaderSegmentedButton = ({
  children,
  onClick,
  title,
  ariaLabel,
  active = false,
  iconOnly = false,
  pill = false,
}: ModuleHeaderSegmentedButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={`${segmentedButtonBaseClassName} ${
        active
          ? `${sidebarTheme.surface} ${sidebarTheme.textPrimary} shadow-[0_1px_2px_rgba(15,23,42,0.08)]`
          : `${sidebarTheme.textSecondary} hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary}`
      } ${iconOnly ? 'w-8 px-0' : ''} ${
        pill
          ? 'rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-4 text-[var(--ledger-text-secondary)] shadow-[0_1px_2px_rgba(17,24,39,0.04)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
          : ''
      }`}
    >
      {children}
    </button>
  );
};

export const ModuleHeaderStatus = ({
  label,
  onClick,
  title,
  ariaLabel,
  state = 'synced',
}: ModuleHeaderStatusProps) => {
  const isButton = typeof onClick === 'function';
  const toneClassName =
    state === 'error'
      ? 'text-[var(--ledger-danger)] border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.08)]'
      : state === 'syncing'
        ? 'text-[var(--ledger-accent)] border-[color:rgba(255,95,64,0.18)] bg-[color:rgba(255,95,64,0.08)]'
        : state === 'offline'
          ? `${sidebarTheme.textSecondary} ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface}`
          : 'text-[var(--ledger-accent)] border-[color:rgba(255,95,64,0.18)] bg-[var(--ledger-surface-card)]';

  const icon =
    state === 'syncing' ? (
      <Loader2 size={12} className="animate-spin text-inherit" />
    ) : (
      <RefreshCw size={12} className="text-inherit" />
    );

  if (isButton) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? label}
        aria-label={ariaLabel ?? label}
        className={`inline-flex h-9 items-center justify-center rounded-full border px-3 transition hover:bg-[var(--ledger-surface-hover)] ${toneClassName}`}
      >
        {icon}
      </button>
    );
  }

  return (
    <div
      title={title ?? label}
      aria-label={ariaLabel ?? label}
      className={`inline-flex h-9 items-center justify-center rounded-full border px-3 ${toneClassName}`}
    >
      {icon}
    </div>
  );
};

export const ModuleHeaderCounterAction = ({
  label,
  icon,
  count,
  onClick,
  title,
  ariaLabel,
}: ModuleHeaderCounterActionProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`relative inline-flex h-8 items-center gap-1.5 rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} px-3 text-xs font-medium ${sidebarTheme.textSecondary} transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary}`}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
};

export const ModuleHeaderStripAction = ({
  icon,
  count,
  onClick,
  title,
  ariaLabel,
}: ModuleHeaderStripActionProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`relative inline-flex h-6 w-6 items-center justify-center rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} ${sidebarTheme.textSecondary} shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary}`}
    >
      {icon}
      {typeof count === 'number' && count > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--ledger-accent)] px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
};

export const ModuleWindowHeader = ({
  eyebrow,
  title,
  subtitle,
  icon,
  onClose,
  onMinimize,
  onToggleFullscreen,
  closeLabel = 'Close window',
  minimizeLabel = 'Minimize window',
  fullscreenLabel = 'Toggle fullscreen',
  showPanelToggle,
  panelToggleLabel,
  onTogglePanels,
  primaryActions,
  secondaryActions,
  viewControls,
  syncStatus,
  globalActions,
  stripActions,
  actions,
}: ModuleWindowHeaderProps) => {
  const controlClassName =
    `flex h-5 w-5 items-center justify-center rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} ${sidebarTheme.textSecondary} shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary}`;

  const topRightActions = globalActions ?? stripActions;
  const rightActions = primaryActions ?? actions;
  const panelToggleText = panelToggleLabel ?? 'Hide panels';

  const handleTitleBarDoubleClick = () => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
    }
  };

  const handleStripDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
    handleTitleBarDoubleClick();
  };

  const triggerOnPrimaryMouseDown = (
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
  };

  return (
    <div className={`w-full border-b ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface}`} style={dragRegionStyle}>
      <div
        className={`flex h-8 w-full cursor-default items-center justify-between border-b ${sidebarTheme.subtleBorder} ${sidebarTheme.hoverSurface} px-4`}
        style={dragRegionStyle}
        onDoubleClickCapture={handleStripDoubleClick}
      >
        <div className="flex items-center gap-1" style={noDragRegionStyle}>
          <button
            type="button"
            onClick={onClose}
            onMouseDown={triggerOnPrimaryMouseDown}
            title={closeLabel}
            aria-label={closeLabel}
            className={controlClassName}
          >
            <X size={12} />
          </button>
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              onMouseDown={triggerOnPrimaryMouseDown}
              title={minimizeLabel}
              aria-label={minimizeLabel}
              className={controlClassName}
            >
              <Minus size={12} />
            </button>
          )}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              onMouseDown={triggerOnPrimaryMouseDown}
              title={fullscreenLabel}
              aria-label={fullscreenLabel}
              className={controlClassName}
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3" style={noDragRegionStyle}>
          <WorkspaceSwitcher />
          {topRightActions && <div className="flex items-center gap-1">{topRightActions}</div>}
        </div>
      </div>

      <div className="flex min-h-12 w-full items-center justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3" style={dragRegionStyle}>
          <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} shadow-[0_1px_2px_rgba(15,23,42,0.04)]`}>
            {icon}
          </div>

          <div className="min-w-0 space-y-0.5">
            {eyebrow && (
              <p className={`text-[11px] font-medium leading-none ${sidebarTheme.textMuted}`}>
                {eyebrow}
              </p>
            )}
            <h1 className={`truncate text-[22px] font-semibold leading-[1.15] tracking-tight ${sidebarTheme.textPrimary}`}>
              {title}
            </h1>
            {subtitle && <p className={`truncate text-[13px] leading-tight ${sidebarTheme.textMuted}`}>{subtitle}</p>}
          </div>
        </div>

        {(showPanelToggle || rightActions || secondaryActions || viewControls || syncStatus) && (
          <div className="flex flex-wrap items-center justify-end gap-1.5" style={noDragRegionStyle}>
            {showPanelToggle && onTogglePanels && (
              <ModuleHeaderActionButton
                onClick={onTogglePanels}
                title={panelToggleText}
                ariaLabel={panelToggleText}
              >
                {panelToggleText}
              </ModuleHeaderActionButton>
            )}
            {rightActions}
            {secondaryActions}
            {viewControls}
            {syncStatus}
          </div>
        )}
      </div>
    </div>
  );
};
