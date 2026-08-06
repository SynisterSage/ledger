import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react';

type CenterSectionLabelProps = {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

type CenterDateHeaderProps = {
  weekday: string;
  date: string | number;
  today?: boolean;
  selected?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
};

export function CenterDateHeader({
  weekday,
  date,
  today = false,
  selected = false,
  onClick,
  className = '',
}: CenterDateHeaderProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-14 flex-col items-center justify-center border-b border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] ${className}`}
    >
      <span
        className={`text-[11px] font-medium ${
          today || selected ? 'text-[var(--ledger-accent)]' : 'text-[var(--ledger-text-muted)]'
        }`}
      >
        {weekday}
      </span>
      <span
        className={`mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] font-medium tabular-nums ${
          selected
            ? 'bg-[var(--ledger-accent)] text-white'
            : today
            ? 'border border-[var(--ledger-accent)] text-[var(--ledger-accent)]'
            : 'text-[var(--ledger-text-secondary)]'
        }`}
      >
        {date}
      </span>
    </button>
  );
}

export function CenterSectionLabel({ children, action, className = '' }: CenterSectionLabelProps) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">{children}</p>
      {action}
    </div>
  );
}

type CenterItemRowProps = {
  title: string;
  time?: string | null;
  detail?: string | null;
  color?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  muted?: boolean;
  completed?: boolean;
  selected?: boolean;
  compact?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
};

type CenterInlineItemRowProps = Omit<CenterItemRowProps, 'onClick' | 'onContextMenu'> & {
  className?: string;
  titleText?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
};

export function CenterInlineItemRow({
  title,
  time,
  color = 'var(--ledger-accent)',
  icon,
  muted = false,
  completed = false,
  selected = false,
  className = '',
  titleText,
  onClick,
  onContextMenu,
}: CenterInlineItemRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.(event as unknown as MouseEvent<HTMLDivElement>);
        }
      }}
      title={titleText ?? title}
      className={`flex min-h-4 w-full items-center gap-1 truncate rounded-md border px-1 py-0 text-[11px] font-normal leading-tight transition-[background-color,border-color,box-shadow] hover:brightness-105 ${
        muted ? 'opacity-60' : ''
      } ${completed ? 'line-through opacity-55' : ''} ${className}`}
      style={{
        backgroundColor: selected
          ? `color-mix(in srgb, ${color} 12%, transparent)`
          : `color-mix(in srgb, ${color} 7%, transparent)`,
        borderColor: selected
          ? `color-mix(in srgb, ${color} 30%, transparent)`
          : `color-mix(in srgb, ${color} 16%, transparent)`,
        boxShadow: selected ? `0 0 0 1px color-mix(in srgb, ${color} 10%, transparent)` : 'none',
      }}
    >
      {icon ? (
        <span className="flex h-3 w-3 shrink-0 items-center justify-center" style={{ color }}>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[var(--ledger-text-primary)]">{title}</span>
      {time ? (
        <span className="ml-auto shrink-0 pl-1 text-[10px] text-[var(--ledger-text-muted)]">
          {time}
        </span>
      ) : null}
    </div>
  );
}

export function CenterItemRow({
  title,
  time,
  detail,
  color = 'var(--ledger-accent)',
  icon,
  trailing,
  muted = false,
  completed = false,
  selected = false,
  compact = false,
  onClick,
  onContextMenu,
}: CenterItemRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`group flex w-full items-center gap-2 rounded-md border text-left transition-[background-color,border-color,box-shadow] hover:brightness-105 ${
        compact ? 'min-h-5 px-1 py-0.5' : 'min-h-10 px-2'
      } ${muted ? 'opacity-55' : ''}`}
      style={{
        backgroundColor: selected
          ? `color-mix(in srgb, ${color} 14%, transparent)`
          : `color-mix(in srgb, ${color} 8%, transparent)`,
        borderColor: selected
          ? `color-mix(in srgb, ${color} 32%, transparent)`
          : `color-mix(in srgb, ${color} 18%, transparent)`,
        boxShadow: selected ? `0 0 0 1px color-mix(in srgb, ${color} 10%, transparent)` : 'none',
      }}
    >
      {icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" style={{ color }}>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[var(--ledger-text-primary)] ${
            compact ? 'text-[11px] leading-4' : 'text-[13px] leading-5'
          } ${completed ? 'line-through' : ''}`}
        >
          {title}
        </span>
        {detail ? (
          <span className="block truncate text-[11px] leading-4 text-[var(--ledger-text-muted)]">
            {detail}
          </span>
        ) : null}
      </span>
      {time ? (
        <span
          className={`${
            compact ? 'text-[10px]' : 'text-[11px]'
          } shrink-0 tabular-nums text-[var(--ledger-text-secondary)]`}
        >
          {time}
        </span>
      ) : null}
      {trailing}
    </button>
  );
}

type CenterEventBlockProps = {
  title: string;
  titleContent?: ReactNode;
  timeRange?: string | null;
  color?: string;
  top: number;
  height: number;
  left?: number | string;
  right?: number | string;
  width?: number | string;
  muted?: boolean;
  selected?: boolean;
  compact?: boolean;
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
};

export function CenterEventBlock({
  title,
  titleContent,
  timeRange,
  color = 'var(--ledger-accent)',
  top,
  height,
  left,
  right,
  width,
  muted = false,
  selected = false,
  compact = false,
  children,
  onClick,
  onContextMenu,
  onPointerDown,
}: CenterEventBlockProps) {
  const style: CSSProperties = {
    top,
    height,
    left,
    right,
    width,
    backgroundColor: selected
      ? `color-mix(in srgb, ${color} 12%, transparent)`
      : muted
      ? 'var(--ledger-surface-hover)'
      : `color-mix(in srgb, ${color} 7%, transparent)`,
    borderColor: selected
      ? color
      : muted
      ? 'var(--ledger-border-subtle)'
      : `color-mix(in srgb, ${color} 24%, transparent)`,
    color: muted ? 'var(--ledger-text-muted)' : 'var(--ledger-text-primary)',
    boxSizing: 'border-box',
    lineHeight: 1.2,
    overflow: 'hidden',
    boxShadow: selected
      ? `0 0 0 1px color-mix(in srgb, ${color} 16%, transparent)`
      : muted
      ? 'none'
      : `0 0 0 1px color-mix(in srgb, ${color} 7%, transparent), 0 1px 2px rgba(15, 23, 42, 0.04)`,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      style={{ ...style, touchAction: 'none' }}
      className={`group absolute z-30 flex flex-col rounded-[5px] border text-left text-[11px] leading-tight transition-[border-color,box-shadow,transform] ${
        compact ? 'px-1.5 py-1' : 'p-2'
      }`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[5px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{
          backgroundColor: muted
            ? 'color-mix(in srgb, var(--ledger-surface-hover) 80%, transparent)'
            : `color-mix(in srgb, ${color} 8%, transparent)`,
        }}
      />
      <span className="relative z-10 flex min-w-0 gap-1.5">
        <span
          className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: muted ? 'var(--ledger-text-muted)' : color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-normal">{titleContent ?? title}</span>
          {timeRange && height >= 62 && !compact ? (
            <span className="mt-1 block truncate text-[10px] text-[var(--ledger-text-muted)]">
              {timeRange}
            </span>
          ) : null}
          {children}
        </span>
      </span>
    </button>
  );
}

type CenterCurrentTimeIndicatorProps = {
  top: number;
  label: string;
  todayColumnIndex: number;
  dateCount: number;
};

export function CenterCurrentTimeIndicator({
  top,
  label,
  todayColumnIndex,
  dateCount,
}: CenterCurrentTimeIndicatorProps) {
  return (
    <div
      aria-label={`Current time ${label}`}
      className="pointer-events-none absolute left-0 right-0 z-40"
      style={{ top }}
    >
      <span className="absolute -top-2 left-4 z-50 rounded-full bg-[var(--ledger-accent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-white shadow-sm">
        {label}
      </span>
      <span
        className="absolute bottom-0 left-0 right-0 top-0 grid"
        style={{ gridTemplateColumns: `72px repeat(${dateCount}, minmax(0, 1fr))` }}
      >
        {todayColumnIndex > 0 ? (
          <span
            className="h-px bg-[var(--ledger-accent)]/25"
            style={{ gridColumn: `2 / ${todayColumnIndex + 2}` }}
          />
        ) : null}
        <span
          className="relative h-px bg-[var(--ledger-accent)]/90"
          style={{ gridColumn: `${todayColumnIndex + 2} / -1` }}
        >
          <span className="absolute -left-[3px] -top-[3px] h-1.5 w-1.5 rounded-full bg-[var(--ledger-accent)]" />
        </span>
      </span>
    </div>
  );
}
