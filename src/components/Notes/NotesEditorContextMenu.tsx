import {
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
  CornerDownLeft,
  CornerDownRight,
  Copy,
  Folder,
  Inbox,
  ListChecks,
  Search,
  UserRound,
  CalendarDays,
  Bell,
  ExternalLink,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type EditorContextMenuPosition = { x: number; y: number };

type Action = {
  label: string;
  shortcut?: string;
  icon: typeof Copy;
  onClick: () => void;
  disabled?: boolean;
};

export type NotesEditorContextMenuProps = {
  position: EditorContextMenuPosition;
  hasSelection: boolean;
  hasSmartDate: boolean;
  hasSmartPerson: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canCut: boolean;
  canPaste: boolean;
  canEdit: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onCreateTask: () => void;
  onCreateReminder: () => void;
  onCreateEvent: () => void;
  onSendToIntake: () => void;
  onLinkProject: () => void;
  onLinkPerson: () => void;
  onSearch: () => void;
  linkUrl?: string | null;
  onOpenLink: () => void;
  onClose: () => void;
};

const shortcut = (key: string) => `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+${key}`;

export const NotesEditorContextMenu = ({
  position,
  hasSelection,
  hasSmartDate,
  hasSmartPerson,
  canUndo,
  canRedo,
  canCut,
  canPaste,
  canEdit,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onCreateTask,
  onCreateReminder,
  onCreateEvent,
  onSendToIntake,
  onLinkProject,
  onLinkPerson,
  onSearch,
  linkUrl,
  onOpenLink,
  onClose,
}: NotesEditorContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - bounds.width - 8);
    const y = Math.min(position.y, window.innerHeight - bounds.height - 8);
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
    window.setTimeout(() => {
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }, 0);
  }, [position]);

  const editingActions: Action[] = [
    {
      label: 'Undo',
      shortcut: shortcut('Z'),
      icon: CornerDownLeft,
      onClick: onUndo,
      disabled: !canUndo,
    },
    {
      label: 'Redo',
      shortcut: shortcut('Shift+Z'),
      icon: CornerDownRight,
      onClick: onRedo,
      disabled: !canRedo,
    },
    ...(hasSelection
      ? [
          {
            label: 'Cut',
            shortcut: shortcut('X'),
            icon: Clipboard,
            onClick: onCut,
            disabled: !canCut || !canEdit,
          },
          { label: 'Copy', shortcut: shortcut('C'), icon: Copy, onClick: onCopy },
        ]
      : []),
    {
      label: 'Paste',
      shortcut: shortcut('V'),
      icon: ClipboardPaste,
      onClick: onPaste,
      disabled: !canPaste || !canEdit,
    },
    { label: 'Select all', shortcut: shortcut('A'), icon: ClipboardCopy, onClick: onSelectAll },
  ];

  const ledgerActions: Action[] = [
    ...(linkUrl ? [{ label: 'Open link', icon: ExternalLink, onClick: onOpenLink }] : []),
    ...(hasSmartDate
      ? [
          { label: 'Create event', icon: CalendarDays, onClick: onCreateEvent },
          { label: 'Create reminder', icon: Bell, onClick: onCreateReminder },
        ]
      : []),
    { label: 'Create task', icon: ListChecks, onClick: onCreateTask },
    ...(!hasSmartDate
      ? [
          { label: 'Create reminder', icon: Bell, onClick: onCreateReminder },
          { label: 'Create event', icon: CalendarDays, onClick: onCreateEvent },
        ]
      : []),
    { label: 'Send to Intake', icon: Inbox, onClick: onSendToIntake },
    { label: 'Link to project', icon: Folder, onClick: onLinkProject, disabled: !canEdit },
    ...(hasSmartPerson
      ? [{ label: 'Link to person', icon: UserRound, onClick: onLinkPerson, disabled: !canEdit }]
      : []),
    ...(hasSelection ? [{ label: 'Search Ledger', icon: Search, onClick: onSearch }] : []),
  ];

  const renderAction = (action: Action) => {
    const Icon = action.icon;
    return (
      <button
        key={action.label}
        type="button"
        role="menuitem"
        disabled={action.disabled}
        onClick={() => {
          if (action.disabled) return;
          action.onClick();
          onClose();
        }}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus-visible:bg-[var(--ledger-surface-hover)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
        <span className="min-w-0 flex-1 truncate">{action.label}</span>
        {action.shortcut && (
          <span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">
            {action.shortcut}
          </span>
        )}
      </button>
    );
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Editor actions"
      className="fixed z-[9999] left-2 top-2 w-[230px] rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const buttons = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
        );
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex =
          event.key === 'ArrowDown'
            ? (currentIndex + 1) % buttons.length
            : (currentIndex - 1 + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
      }}
    >
      {editingActions.map(renderAction)}
      {(hasSelection || linkUrl) && (
        <>
          <div className="my-1 h-px bg-[var(--ledger-border-subtle)]" />
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">
            Ledger
          </p>
          {ledgerActions.map(renderAction)}
        </>
      )}
    </div>,
    document.body
  );
};
