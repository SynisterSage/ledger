import { type ReactNode, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';

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
  stripActions?: ReactNode;
  actions?: ReactNode;
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
  stripActions,
  actions,
}: ModuleWindowHeaderProps) => {
  const controlClassName =
    'flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-950';

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
        className="flex h-9 items-center justify-between border-b border-gray-200 bg-gray-50 px-3.5 py-1.5 cursor-default"
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
            <X size={13} />
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
              <Minus size={13} />
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
              <Maximize2 size={13} />
            </button>
          )}
        </div>

        {stripActions && (
          <div className="flex items-center gap-1" style={noDragRegionStyle}>
            {stripActions}
          </div>
        )}
      </div>

      <div className="flex min-h-16 items-center justify-between gap-4 px-5 py-3">
        <div className="flex min-w-0 items-center gap-4" style={dragRegionStyle}>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 shadow-sm">
            {icon}
          </div>

          <div className="min-w-0 space-y-0.5">
            {eyebrow && (
              <p className="text-xs font-medium leading-none text-gray-500">
                {eyebrow}
              </p>
            )}
            <h1 className="truncate text-[23px] font-semibold leading-[1.15] tracking-tight text-gray-900">
              {title}
            </h1>
            {subtitle && <p className="truncate text-xs leading-tight text-gray-500">{subtitle}</p>}
          </div>
        </div>

        {actions && (
          <div className="flex flex-wrap items-center justify-end gap-1.5" style={noDragRegionStyle}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};
