import {
  type ReactNode,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
} from 'react';
import {
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
};

type ModuleHeaderActionButtonProps = {
  children: ReactNode;
  onClick: () => void;
  title: string;
  ariaLabel?: string;
  icon?: ReactNode;
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

type AppRegionStyle = CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

const dragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'drag' };
const noDragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'no-drag' };
const HEADER_DRAG_THRESHOLD_PX = 3;
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
  icon,
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
      {icon}
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
  compact = false,
}: ModuleWindowHeaderProps) => {
  void icon;
  const controlClassName =
    `flex h-5 w-5 items-center justify-center rounded-full border ${sidebarTheme.subtleBorder} ${sidebarTheme.mutedSurface} ${sidebarTheme.textSecondary} shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:${sidebarTheme.hoverSurface} hover:${sidebarTheme.textPrimary}`;

  const topRightActions = globalActions ?? stripActions;
  const rightActions = primaryActions ?? actions;
  const panelToggleText = panelToggleLabel ?? 'Hide panels';
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

  const triggerOnPrimaryMouseDown = (
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
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
    void window.desktopWindow?.updateHeaderDrag();
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

        <div
          className="mx-3 h-full min-w-0 flex-1"
          style={noDragRegionStyle}
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={finishHeaderPointerDrag}
          onPointerCancel={finishHeaderPointerDrag}
          onDoubleClick={handleStripDoubleClick}
          aria-hidden="true"
        />

        <div className="flex items-center gap-3" style={noDragRegionStyle}>
          <WorkspaceSwitcherMenu variant="header" />
          {topRightActions && <div className="flex items-center gap-1">{topRightActions}</div>}
        </div>
      </div>

      <div
        className={`flex w-full items-center justify-between gap-4 px-6 ${
          compact ? 'min-h-10 py-2' : 'min-h-12 py-3'
        }`}
        onDoubleClickCapture={handleStripDoubleClick}
      >
        <div className="min-w-0 space-y-0.5" style={dragRegionStyle}>
          {eyebrow && <p className={`text-[11px] font-medium leading-none ${sidebarTheme.textMuted}`}>{eyebrow}</p>}
          <h1
            className={`truncate font-semibold leading-[1.15] tracking-tight ${sidebarTheme.textPrimary} ${
              compact ? 'text-[18px]' : 'text-[22px]'
            }`}
          >
            {title}
          </h1>
          {subtitle && (
            <p className={`truncate leading-tight ${sidebarTheme.textMuted} ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
              {subtitle}
            </p>
          )}
        </div>

        {(showPanelToggle || rightActions || secondaryActions || viewControls || syncStatus) && (
          <div className="flex flex-wrap items-center justify-end gap-1.5" style={noDragRegionStyle}>
            {showPanelToggle && onTogglePanels && (
              <ModuleHeaderActionButton
                onClick={onTogglePanels}
                title={panelToggleText}
                ariaLabel={panelToggleText}
                icon={panelToggleIcon}
                iconOnly
              >
                <span className="sr-only">{panelToggleText}</span>
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
