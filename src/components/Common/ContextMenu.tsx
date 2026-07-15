import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { sidebarTheme } from '../Sidebar/sidebarTheme';

export type ContextMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  onClick: () => void;
};

export type ContextMenuGroup = {
  label?: string;
  items: ContextMenuItem[];
};

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  width?: number;
  groups: ContextMenuGroup[];
  onClose: () => void;
  ariaLabel?: string;
};

const VIEWPORT_PADDING = 8;

export const ContextMenu = ({
  open,
  x,
  y,
  width = 236,
  groups,
  onClose,
  ariaLabel,
}: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !item.hidden),
        }))
        .filter((group) => group.items.length > 0),
    [groups]
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const firstEnabled = menuRef.current?.querySelector<HTMLButtonElement>(
      'button[role="menuitem"]:not(:disabled)'
    );
    firstEnabled?.focus();
  }, [open, visibleGroups]);

  if (!open || typeof document === 'undefined') return null;

  const estimatedHeight = Math.max(120, visibleGroups.reduce((sum, group) => sum + group.items.length * 36 + (group.label ? 20 : 0) + 8, 0));
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(x, window.innerWidth - width - VIEWPORT_PADDING)
  );
  const top = Math.max(
    VIEWPORT_PADDING,
    Math.min(y, window.innerHeight - estimatedHeight - VIEWPORT_PADDING)
  );

  const allItems = visibleGroups.flatMap((group) => group.items);

  const focusItem = (nextIndex: number) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ??
        []
    );
    buttons[nextIndex]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!allItems.length) return;
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ??
        []
    );
    const currentIndex = buttons.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem((currentIndex + 1 + allItems.length) % allItems.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem((currentIndex - 1 + allItems.length) % allItems.length);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusItem(allItems.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const active = document.activeElement as HTMLButtonElement | null;
      active?.click();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={sidebarTheme.menu}
      style={{ left, top, width, zIndex: 210 }}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {visibleGroups.map((group, groupIndex) => (
        <div key={`${group.label ?? 'group'}-${groupIndex}`}>
          {group.label && (
            <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">
              {group.label}
            </div>
          )}
          {group.items.map((item) => {
            const className = item.destructive ? sidebarTheme.menuItemDanger : sidebarTheme.menuItem;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onClick();
                }}
                className={`${className} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
                <span className="min-w-0 truncate">{item.label}</span>
              </button>
            );
          })}
          {groupIndex < visibleGroups.length - 1 && <div className="my-1 border-t border-[color:var(--ledger-border-subtle)]" />}
        </div>
      ))}
    </div>,
    document.body
  );
};
