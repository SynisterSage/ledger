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
        className="inline-flex h-7 min-w-28 max-w-60 items-center gap-1.5 text-left text-xs font-medium text-gray-400 opacity-70"
        style={noDragRegionStyle}
      >
        <span className="min-w-0 flex-1 truncate">Workspace</span>
        <ChevronDown size={13} className="shrink-0 text-gray-500" />
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
        className={`inline-flex h-7 min-w-28 max-w-60 items-center gap-1.5 text-left text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300/80 ${
          isOpen ? 'text-gray-900' : 'text-gray-700 hover:text-gray-900'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{resolvedLabel}</span>
        <ChevronDown size={13} className="shrink-0 text-gray-500" />
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
                className="max-h-60 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-[0_16px_48px_rgba(15,23,42,0.14)] ring-0 outline-none"
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
                        className={`group flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5F40]/20 ${
                          isActive
                            ? 'bg-gray-50 text-gray-950'
                            : 'text-gray-700 hover:bg-gray-50 hover:text-gray-950'
                        }`}
                        style={noDragRegionStyle}
                        aria-current={isActive ? 'true' : undefined}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            isActive ? 'bg-[#FF5F40]' : 'bg-gray-300'
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
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300/80';

const iconButtonClassName =
  'inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300/80';

const segmentedGroupClassName =
  'inline-flex h-9 items-center rounded-full border border-gray-200 bg-gray-50 p-0.5';

const segmentedButtonBaseClassName =
  'inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300/80';

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
        disabled ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-50 hover:text-gray-400' : ''
      }`}
    >
      {children}
      {!iconOnly && active && (
        <span className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-[#FF5F40]" />
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
}: ModuleHeaderSegmentedButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={`${segmentedButtonBaseClassName} ${
        active ? 'bg-white text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)]' : 'text-gray-600 hover:bg-white hover:text-gray-900'
      } ${iconOnly ? 'w-8 px-0' : ''}`}
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
      ? 'text-red-700 border-red-200 bg-red-50'
      : state === 'syncing'
        ? 'text-[#FF5F40] border-orange-200 bg-orange-50'
        : state === 'offline'
          ? 'text-gray-600 border-gray-200 bg-gray-50'
          : 'text-[#FF5F40] border-orange-200 bg-white';

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
        className={`inline-flex h-9 items-center justify-center rounded-full border px-3 transition hover:bg-orange-50 ${toneClassName}`}
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
      className="relative inline-flex h-8 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-[#FF5F40] px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
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
      className="relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-950"
    >
      {icon}
      {typeof count === 'number' && count > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-[#FF5F40] px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
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
    'flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-950';

  const topRightActions = globalActions ?? stripActions;
  const rightActions = primaryActions ?? actions;
  const panelToggleText = panelToggleLabel ?? 'Hide panels';

  const handleTitleBarDoubleClick = () => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
    }
  };

  const triggerOnPrimaryMouseDown = (
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
  };

  return (
    <div className="border-b border-gray-200 bg-white" style={dragRegionStyle}>
      <div
        className="flex h-8 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 cursor-default"
        style={dragRegionStyle}
        onDoubleClick={handleTitleBarDoubleClick}
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

      <div className="flex min-h-12 items-center justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3" style={dragRegionStyle}>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {icon}
          </div>

          <div className="min-w-0 space-y-0.5">
            {eyebrow && (
              <p className="text-[11px] font-medium leading-none text-gray-500">
                {eyebrow}
              </p>
            )}
            <h1 className="truncate text-[22px] font-semibold leading-[1.15] tracking-tight text-gray-900">
              {title}
            </h1>
            {subtitle && <p className="truncate text-[13px] leading-tight text-gray-500">{subtitle}</p>}
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
