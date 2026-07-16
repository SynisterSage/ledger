import {
  Bell,
  CalendarDays,
  ChevronDown,
  Folder,
  FolderInput,
  Link2,
  PinOff,
  StickyNote,
  Users,
  CheckSquare2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuthContext } from '../../context/AuthContext';
import { ContextMenu, type ContextMenuGroup } from '../Common/ContextMenu';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { usePins } from '../../context/PinsContext';
import { sidebarTheme } from './sidebarTheme';
import { getPinNavigationTarget, type PinRecord } from '../../utils/pins';

type MenuState = {
  type: 'pin';
  x: number;
  y: number;
  pinId: string;
};

type DragState = {
  kind: 'pin';
  id: string;
} | null;

type DropHint =
  | {
      kind: 'pin';
      pinId: string;
      position: 'before' | 'after';
    }
  | {
      kind: 'root';
    }
  | null;

const PIN_SECTION_COLLAPSE_STORAGE_KEY = 'ledger:sidebar:pinned-collapsed:v1';

const getStorageScope = (userId?: string | null, workspaceId?: string | null) =>
  userId && workspaceId ? `${userId}:${workspaceId}` : null;

const sortPins = (pins: PinRecord[]) =>
  [...pins].sort((a, b) => {
    const diff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
    if (diff !== 0) return diff;
    return String(a.title ?? '').localeCompare(String(b.title ?? ''));
  });

const getPinIcon = (pin: PinRecord) => {
  switch (pin.icon_kind) {
    case 'person':
      return (
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold leading-none text-white"
          style={{ backgroundColor: pin.color || 'var(--ledger-accent)' }}
        >
          {String(pin.initials ?? pin.title ?? 'P')
            .trim()
            .slice(0, 2)
            .toUpperCase()}
        </span>
      );
    case 'project':
      return <Folder size={12} />;
    case 'note':
      return <StickyNote size={12} />;
    case 'team':
      return <Users size={12} />;
    case 'task':
      return <CheckSquare2 size={12} />;
    case 'event':
      return <CalendarDays size={12} />;
    case 'reminder':
      return <Bell size={12} />;
    default:
      return <Link2 size={12} />;
  }
};

const resolvePinTarget = (pin: PinRecord) => getPinNavigationTarget(pin);

const getPinnedTypeLabel = (pin: PinRecord) => {
  switch (pin.object_type) {
    case 'person':
      return 'Circle';
    case 'project':
      return 'Project';
    case 'note':
      return 'Note';
    case 'team':
      return 'Team';
    case 'task':
      return 'Task';
    case 'event':
      return 'Event';
    case 'reminder':
      return 'Reminder';
    case 'saved_view':
      return 'Saved view';
    case 'follow_up_view':
      return 'Follow-up view';
    case 'team_page':
      return 'Team';
    default:
      return '';
  }
};

export const PinnedSidebarSection = () => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const { pins, activePinId, isLoadingPins, reorderPins, unpinObject } = usePins();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);
  const [optimisticPins, setOptimisticPins] = useState<PinRecord[] | null>(null);

  const storageScope = getStorageScope(user?.id, activeWorkspaceId);
  const visiblePins = sortPins(optimisticPins ?? pins);

  useEffect(() => {
    if (!storageScope) {
      setIsCollapsed(false);
      return;
    }

    try {
      const raw = window.localStorage.getItem(
        `${PIN_SECTION_COLLAPSE_STORAGE_KEY}:${storageScope}`
      );
      setIsCollapsed(raw === '1');
    } catch {
      setIsCollapsed(false);
    }
  }, [storageScope]);

  useEffect(() => {
    if (!menuState) return;

    const handlePointerDown = () => {
      setMenuState(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuState(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuState]);

  useEffect(() => {
    if (!menuState) return;
    const onResize = () => setMenuState(null);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [menuState]);

  const totalCount = visiblePins.length;
  const canRender = isLoadingPins || totalCount > 0;

  useEffect(() => {
    if (totalCount === 0 && !isLoadingPins) {
      setIsCollapsed(false);
    }
  }, [isLoadingPins, totalCount]);

  const persistCollapsed = (nextValue: boolean) => {
    setIsCollapsed(nextValue);
    if (!storageScope) return;
    try {
      window.localStorage.setItem(
        `${PIN_SECTION_COLLAPSE_STORAGE_KEY}:${storageScope}`,
        nextValue ? '1' : '0'
      );
    } catch {
      // ignore storage failures
    }
  };

  const openPin = (pin: PinRecord, openInNewWindow = false) => {
    const target = resolvePinTarget(pin);
    if (!target) return;
    const openMethod =
      openInNewWindow || target.openInNewWindow
        ? window.desktopWindow?.openModule
        : window.desktopWindow?.toggleModule;
    void openMethod?.(target.module as any, target.focus as any);
  };

  const handlePinDelete = async (pinId: string) => {
    setMenuState(null);
    await unpinObject(pinId);
  };

  const menuGroups = (): ContextMenuGroup[] | null => {
    if (!menuState) return null;
    if (menuState.type !== 'pin') return null;
    const pin = visiblePins.find((item) => item.id === menuState.pinId);
    if (!pin) return null;
    const target = resolvePinTarget(pin);
    const canOpenInNewWindow = Boolean(target?.openInNewWindow);
    return [
      {
        items: [
          {
            id: 'open',
            label: pin.object_type === 'note' ? 'Open note' : 'Open',
            icon: <StickyNote size={14} />,
            onClick: () => openPin(pin),
          },
          {
            id: 'open-new',
            label: 'Open in new window',
            icon: <FolderInput size={14} />,
            hidden: !canOpenInNewWindow,
            onClick: () => openPin(pin, true),
          },
          {
            id: 'unpin',
            label: pin.object_type === 'note' ? 'Unpin note' : 'Unpin',
            icon: <PinOff size={14} />,
            onClick: () => void handlePinDelete(pin.id),
          },
        ],
      },
    ];
  };

  const handlePinReorder = async (draggedId: string, target: DropHint) => {
    const sourcePin = visiblePins.find((pin) => pin.id === draggedId);
    if (!sourcePin || !target) return;

    const nextPins = visiblePins
      .filter((pin) => pin.id !== draggedId)
      .map((pin) => ({
        ...pin,
        folder_id: null,
      }));

    if (target.kind === 'pin') {
      const targetPin = visiblePins.find((pin) => pin.id === target.pinId);
      if (!targetPin) return;
      const targetIndex = nextPins.findIndex((pin) => pin.id === target.pinId);
      const insertIndex = target.position === 'before' ? targetIndex : targetIndex + 1;
      nextPins.splice(insertIndex < 0 ? nextPins.length : insertIndex, 0, {
        ...sourcePin,
        folder_id: null,
      });
    } else {
      nextPins.push({ ...sourcePin, folder_id: null });
    }

    const flattened = nextPins.map((pin, index) => ({
      ...pin,
      sort_order: index,
      folder_id: null,
    }));
    setOptimisticPins(flattened);
    try {
      await reorderPins(
        flattened.map((pin, index) => ({ id: pin.id, folder_id: null, sort_order: index }))
      );
    } finally {
      setOptimisticPins(null);
    }
  };

  const pinRowClass = (isActive: boolean, isDragging: boolean) =>
    `group grid h-8 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 text-left text-[12px] transition ${
      isActive ? sidebarTheme.selectedSurface : 'hover:bg-[var(--ledger-surface-muted)]'
    } ${isDragging ? 'opacity-60' : ''}`;

  const renderPinRow = (pin: PinRecord) => {
    const isActive = activePinId === pin.id;
    const isDragging = dragState?.kind === 'pin' && dragState.id === pin.id;
    const showBefore =
      dropHint?.kind === 'pin' && dropHint.pinId === pin.id && dropHint.position === 'before';
    const showAfter =
      dropHint?.kind === 'pin' && dropHint.pinId === pin.id && dropHint.position === 'after';

    return (
      <div key={pin.id} className="relative">
        {showBefore && (
          <div className="absolute -top-0.5 left-2 right-2 h-px bg-[var(--ledger-accent)]" />
        )}
        <button
          type="button"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', pin.id);
            setDragState({ kind: 'pin', id: pin.id });
          }}
          onDragEnd={() => {
            setDragState(null);
            setDropHint(null);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const before = event.clientY < rect.top + rect.height / 2;
            setDropHint({ kind: 'pin', pinId: pin.id, position: before ? 'before' : 'after' });
          }}
          onDrop={(event) => {
            event.preventDefault();
            const draggedId = event.dataTransfer.getData('text/plain') || dragState?.id;
            if (draggedId && draggedId !== pin.id) {
              void handlePinReorder(
                draggedId,
                dropHint ?? { kind: 'pin', pinId: pin.id, position: 'after' }
              );
            }
            setDragState(null);
            setDropHint(null);
          }}
          onClick={() => {
            openPin(pin);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuState({ type: 'pin', x: event.clientX, y: event.clientY, pinId: pin.id });
          }}
          className={pinRowClass(isActive, isDragging)}
          title={`${getPinnedTypeLabel(pin)} ${pin.title}`}
        >
          {pin.icon_kind === 'person' ? (
            getPinIcon(pin)
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--ledger-text-secondary)]">
              {getPinIcon(pin)}
            </span>
          )}
          <span className="min-w-0 truncate text-[13px] text-[var(--ledger-text-primary)]">
            {pin.title}
          </span>
          <span className="flex items-center gap-0.5 text-[10px] text-[var(--ledger-text-muted)]">
            <span className="shrink-0">{getPinnedTypeLabel(pin)}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handlePinDelete(pin.id);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ledger-text-muted)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              aria-label={`Unpin ${pin.title}`}
              title="Unpin"
            >
              <X size={12} />
            </button>
          </span>
        </button>
        {showAfter && (
          <div className="absolute -bottom-0.5 left-2 right-2 h-px bg-[var(--ledger-accent)]" />
        )}
      </div>
    );
  };

  if (!canRender) return null;

  return (
    <section className="order-3 space-y-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => persistCollapsed(!isCollapsed)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          persistCollapsed(!isCollapsed);
        }}
        className="group flex w-full items-center justify-between gap-3 px-0.5 text-left text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">Pinned</span>
          <ChevronDown
            size={12}
            className={`shrink-0 text-[var(--ledger-text-muted)] transition-transform ${
              isCollapsed ? 'rotate-180' : ''
            }`}
          />
        </span>
        <span className="flex items-center gap-1">
          {totalCount > 0 && (
            <span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">
              {totalCount}
            </span>
          )}
        </span>
      </div>

      {!isCollapsed ? (
        <div
          className="space-y-1.5 pl-1"
          onDragOver={(event) => {
            if (dragState?.kind !== 'pin') return;
            event.preventDefault();
            setDropHint({ kind: 'root' });
          }}
          onDrop={(event) => {
            if (dragState?.kind !== 'pin') return;
            event.preventDefault();
            const draggedId = event.dataTransfer.getData('text/plain') || dragState?.id;
            if (!draggedId) return;
            void handlePinReorder(draggedId, { kind: 'root' });
            setDragState(null);
            setDropHint(null);
          }}
        >
          {totalCount > 0 ? (
            <div className="space-y-0.5">
              {dropHint?.kind === 'root' && <div className="mx-2 h-px bg-[var(--ledger-accent)]" />}
              {visiblePins.map((pin) => renderPinRow(pin))}
            </div>
          ) : isLoadingPins ? (
            <div className="space-y-1.5">
              <div className="h-8 animate-pulse rounded-lg bg-[var(--ledger-surface-muted)]" />
              <div className="h-8 animate-pulse rounded-lg bg-[var(--ledger-surface-muted)]" />
            </div>
          ) : dragState?.kind === 'pin' ? (
            <div className="rounded-lg border border-dashed border-[color:var(--ledger-border-subtle)] px-2 py-1.5 text-[11px] text-[var(--ledger-text-muted)]">
              Drop to root
            </div>
          ) : null}
        </div>
      ) : null}

      {menuState && (
        <ContextMenu
          open
          x={menuState.x}
          y={menuState.y}
          width={228}
          groups={menuGroups() ?? []}
          onClose={() => setMenuState(null)}
          ariaLabel="Pinned item actions"
        />
      )}
    </section>
  );
};
