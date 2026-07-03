import {
  type ReactNode,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minus,
  RefreshCw,
  SidebarClose,
  SidebarOpen,
  X,
} from 'lucide-react';
import { sidebarTheme } from '../Sidebar/sidebarTheme';
import { WorkspaceSwitcherMenu } from './WorkspaceSwitcherMenu';

type ModuleWindowHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  stripTitle?: string;
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
  compact?: boolean;
  showBodyHeader?: boolean;
  showWorkspaceNavigation?: boolean;
};

type ModuleHeaderActionButtonProps = {
  children: ReactNode;
  onClick: () => void;
  title: string;
  ariaLabel?: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  square?: boolean;
  active?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'strip';
};

type ModuleHeaderSegmentedGroupProps = {
  children: ReactNode;
  compact?: boolean;
};

type ModuleHeaderSegmentedButtonProps = {
  children: ReactNode;
  onClick: () => void;
  title: string;
  ariaLabel?: string;
  active?: boolean;
  iconOnly?: boolean;
  pill?: boolean;
  compact?: boolean;
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

type WorkspaceNavigationState = {
  canGoBack: boolean;
  canGoForward: boolean;
};

type AppRegionStyle = CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

const dragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'drag' };
const noDragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'no-drag' };
const HEADER_DRAG_THRESHOLD_PX = 3;
const actionButtonClassName = `inline-flex h-9 items-center justify-center gap-1.5 rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} px-3.5 text-xs font-medium ${sidebarTheme.textSecondary} transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20`;

const iconButtonClassName = `inline-flex h-9 w-9 items-center justify-center rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} ${sidebarTheme.textSecondary} transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20`;

const segmentedGroupClassName = `inline-flex h-9 items-center rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.hoverSurface} p-0.5`;
const segmentedGroupCompactClassName = `inline-flex h-7 items-center rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.hoverSurface} p-[2px]`;

const segmentedButtonBaseClassName =
  'inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20';
const segmentedButtonCompactBaseClassName =
  'inline-flex h-6 items-center justify-center rounded-full px-2.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20';
const stripIconButtonClassName = `inline-flex h-7 w-7 items-center justify-center rounded-lg ${sidebarTheme.textSecondary} transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20`;
const stripIconButtonDisabledClassName = `cursor-not-allowed opacity-35 hover:bg-transparent hover:${sidebarTheme.textSecondary}`;

export const ModuleHeaderActionButton = ({
  children,
  onClick,
  title,
  ariaLabel,
  icon,
  iconOnly = false,
  square = false,
  active = false,
  disabled = false,
  variant = 'default',
}: ModuleHeaderActionButtonProps) => {
  const isStripIconOnly = variant === 'strip' && iconOnly;
  const resolvedClassName =
    variant === 'strip'
      ? `${
          square || isStripIconOnly
            ? 'inline-flex h-7 w-7 items-center justify-center rounded-md'
            : 'inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium'
        } text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20 ${
          active ? 'text-[var(--ledger-text-primary)]' : ''
        } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`
      : iconOnly
      ? iconButtonClassName
      : actionButtonClassName;
  const resolvedDisabledClassName =
    variant === 'strip'
      ? ''
      : disabled
      ? `cursor-not-allowed ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} ${sidebarTheme.textMuted} hover:${sidebarTheme.mutedSurface} hover:${sidebarTheme.textMuted}`
      : '';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? title}
      className={`${resolvedClassName} ${resolvedDisabledClassName}`}
    >
      {icon}
      {!isStripIconOnly && !square && children}
      {variant !== 'strip' && !iconOnly && active && (
        <span className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-[var(--ledger-accent)]" />
      )}
    </button>
  );
};

export const ModuleHeaderSegmentedGroup = ({
  children,
  compact = false,
}: ModuleHeaderSegmentedGroupProps) => {
  return (
    <div className={compact ? segmentedGroupCompactClassName : segmentedGroupClassName}>
      {children}
    </div>
  );
};

export const ModuleHeaderSegmentedButton = ({
  children,
  onClick,
  title,
  ariaLabel,
  active = false,
  iconOnly = false,
  pill = false,
  compact = false,
}: ModuleHeaderSegmentedButtonProps) => {
  const baseClassName = compact
    ? segmentedButtonCompactBaseClassName
    : segmentedButtonBaseClassName;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={`${baseClassName} ${
        active
          ? `${sidebarTheme.surface} ${sidebarTheme.textPrimary} shadow-[0_1px_2px_rgba(15,23,42,0.08)]`
          : `${sidebarTheme.textSecondary} hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary}`
      } ${iconOnly ? (compact ? 'w-7 px-0' : 'w-8 px-0') : ''} ${
        pill
          ? `${
              compact
                ? 'rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-[var(--ledger-text-secondary)] shadow-[0_1px_2px_rgba(17,24,39,0.04)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                : 'rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-4 text-[var(--ledger-text-secondary)] shadow-[0_1px_2px_rgba(17,24,39,0.04)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
            }`
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
      : `${sidebarTheme.textSecondary} ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface}`;

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
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary} ${toneClassName}`}
      >
        {icon}
      </button>
    );
  }

  return (
    <div
      title={title ?? label}
      aria-label={ariaLabel ?? label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border ${toneClassName}`}
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
  compact = false,
  stripTitle,
  showBodyHeader = true,
  showWorkspaceNavigation = true,
}: ModuleWindowHeaderProps) => {
  void icon;
  const controlClassName = `flex h-5 w-5 items-center justify-center rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} ${sidebarTheme.textSecondary} shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary}`;

  const topRightActions = globalActions ?? stripActions;
  const rightActions = primaryActions ?? actions;
  const panelToggleText = panelToggleLabel ?? 'Hide panels';
  const resolvedStripTitle = stripTitle ?? (compact ? title : null);
  const stripPageActions = [viewControls, rightActions, secondaryActions, syncStatus].filter(
    Boolean
  );
  const panelToggleIcon = panelToggleText.toLowerCase().includes('show') ? (
    <SidebarOpen size={12} />
  ) : (
    <SidebarClose size={12} />
  );
  const headerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);
  const [workspaceNavigationState, setWorkspaceNavigationState] =
    useState<WorkspaceNavigationState>({
      canGoBack: false,
      canGoForward: false,
    });

  useEffect(() => {
    let mounted = true;

    const loadNavigationState = async () => {
      try {
        const nextState = await window.desktopWindow?.getWorkspaceNavigationState?.();
        if (!mounted || !nextState) return;
        setWorkspaceNavigationState({
          canGoBack: Boolean(nextState.canGoBack),
          canGoForward: Boolean(nextState.canGoForward),
        });
      } catch {
        // Browser dev mode and older desktop builds may not expose workspace history yet.
      }
    };

    const handleNavigationState = (
      _event: unknown,
      nextState?: Partial<WorkspaceNavigationState>
    ) => {
      setWorkspaceNavigationState({
        canGoBack: Boolean(nextState?.canGoBack),
        canGoForward: Boolean(nextState?.canGoForward),
      });
    };

    if (showWorkspaceNavigation) {
      void loadNavigationState();
      window.ipcRenderer?.on?.('workspace:navigation-state', handleNavigationState as any);
    }

    return () => {
      mounted = false;
      window.ipcRenderer?.off?.('workspace:navigation-state', handleNavigationState as any);
    };
  }, [showWorkspaceNavigation]);

  const handleTitleBarDoubleClick = () => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
    }
  };

  const handleStripDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
    event.preventDefault();
    event.stopPropagation();
    handleTitleBarDoubleClick();
  };

  const triggerOnPrimaryMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
  };

  const handleGoBack = () => {
    if (!workspaceNavigationState.canGoBack) return;
    void window.desktopWindow?.goBackWorkspaceWindow?.();
  };

  const handleGoForward = () => {
    if (!workspaceNavigationState.canGoForward) return;
    void window.desktopWindow?.goForwardWorkspaceWindow?.();
  };

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    headerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = headerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const movedDistance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);

    if (!drag.isDragging) {
      if (movedDistance < HEADER_DRAG_THRESHOLD_PX) return;
      drag.isDragging = true;
      void window.desktopWindow?.beginHeaderDrag();
    }

    event.preventDefault();
  };

  const finishHeaderPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = headerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    headerDragRef.current = null;
    if (drag.isDragging) {
      event.preventDefault();
      void window.desktopWindow?.finishHeaderDrag();
    }
  };

  return (
    <div
      className={`w-full border-b ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface}`}
      style={dragRegionStyle}
      onDoubleClickCapture={handleStripDoubleClick}
    >
      <div
        className={`flex h-10 w-full cursor-default items-center justify-between border-b ${sidebarTheme.subtleBorder} ${sidebarTheme.hoverSurface} px-4`}
        style={dragRegionStyle}
        onDoubleClickCapture={handleStripDoubleClick}
      >
        <div className="flex items-center gap-2" style={noDragRegionStyle}>
          <div className="flex items-center gap-1">
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

          <div
            aria-hidden="true"
            className="mx-1.5 self-stretch border-l border-[color:var(--ledger-border-subtle)]"
          />

          <div className="flex items-center gap-0.5">
            {showWorkspaceNavigation && (
              <>
                <button
                  type="button"
                  onClick={handleGoBack}
                  disabled={!workspaceNavigationState.canGoBack}
                  title="Back"
                  aria-label="Back"
                  className={`${stripIconButtonClassName} ${
                    !workspaceNavigationState.canGoBack ? stripIconButtonDisabledClassName : ''
                  }`}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleGoForward}
                  disabled={!workspaceNavigationState.canGoForward}
                  title="Forward"
                  aria-label="Forward"
                  className={`${stripIconButtonClassName} ${
                    !workspaceNavigationState.canGoForward ? stripIconButtonDisabledClassName : ''
                  }`}
                >
                  <ChevronRight size={16} />
                </button>
              </>
            )}
            {showPanelToggle && onTogglePanels && (
              <button
                type="button"
                onClick={onTogglePanels}
                title={panelToggleText}
                aria-label={panelToggleText}
                className={`${stripIconButtonClassName} ${
                  panelToggleText.toLowerCase().includes('show')
                    ? `${sidebarTheme.hoverSurface} ${sidebarTheme.textPrimary}`
                    : ''
                }`}
              >
                {panelToggleIcon}
              </button>
            )}
          </div>
        </div>

        <div
          className="ml-3 flex min-w-0 flex-1 items-center gap-3"
          style={noDragRegionStyle}
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={finishHeaderPointerDrag}
          onPointerCancel={finishHeaderPointerDrag}
          onDoubleClick={handleStripDoubleClick}
        >
          {resolvedStripTitle ? (
            <div className="min-w-0 max-w-[26vw] flex-none" title={resolvedStripTitle}>
              <p
                className={`truncate text-[12px] font-medium leading-none tracking-tight text-[var(--ledger-text-primary)] ${
                  compact ? 'sm:text-[13px]' : ''
                }`}
              >
                {resolvedStripTitle}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3" style={noDragRegionStyle}>
          {compact && stripPageActions.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">{stripPageActions}</div>
          )}
          {compact && stripPageActions && (
            <div
              aria-hidden="true"
              className="self-stretch border-l border-[color:var(--ledger-border-subtle)]"
            />
          )}
          <WorkspaceSwitcherMenu variant="header" />
          {topRightActions && <div className="flex items-center gap-1">{topRightActions}</div>}
        </div>
      </div>

      {showBodyHeader && (
        <div
          className={`flex w-full items-center justify-between gap-4 px-6 ${
            compact ? 'min-h-9 py-1.5' : 'min-h-12 py-3'
          }`}
          onDoubleClickCapture={handleStripDoubleClick}
        >
          <div className="min-w-0 space-y-0.5" style={dragRegionStyle}>
            {eyebrow && (
              <p className={`text-[11px] font-medium leading-none ${sidebarTheme.textMuted}`}>
                {eyebrow}
              </p>
            )}
            <h1
              className={`truncate font-semibold leading-[1.15] tracking-tight ${
                sidebarTheme.textPrimary
              } ${compact ? 'text-[18px]' : 'text-[22px]'}`}
            >
              {title}
            </h1>
            {subtitle && (
              <p
                className={`truncate leading-tight ${sidebarTheme.textMuted} ${
                  compact ? 'text-[12px]' : 'text-[13px]'
                }`}
              >
                {subtitle}
              </p>
            )}
          </div>

          {!compact && (rightActions || secondaryActions || viewControls || syncStatus) && (
            <div
              className="flex flex-wrap items-center justify-end gap-1.5"
              style={noDragRegionStyle}
            >
              {rightActions}
              {secondaryActions}
              {viewControls}
              {syncStatus}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
