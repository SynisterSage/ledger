import {
  Bell,
  CalendarDays,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  MoreHorizontal,
  PinOff,
  StickyNote,
  Users,
  CheckSquare2,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { usePins } from '../../context/PinsContext';
import { sidebarTheme } from './sidebarTheme';
import { getPinNavigationTarget, type PinFolder, type PinRecord } from '../../utils/pins';

type MenuState =
  | {
      type: 'header';
      x: number;
      y: number;
    }
  | {
      type: 'pin';
      x: number;
      y: number;
      pinId: string;
    }
  | {
      type: 'folder';
      x: number;
      y: number;
      folderId: string;
    }
  | {
      type: 'move';
      x: number;
      y: number;
      pinId: string;
    };

type DragState =
  | {
      kind: 'pin';
      id: string;
    }
  | {
      kind: 'folder';
      id: string;
    }
  | null;

type DropHint =
  | {
      kind: 'pin';
      pinId: string;
      position: 'before' | 'after';
    }
  | {
      kind: 'folder';
      folderId: string;
    }
  | {
      kind: 'root';
    }
  | null;

const PIN_SECTION_COLLAPSE_STORAGE_KEY = 'ledger:sidebar:pinned-collapsed:v1';
const menuWidth = 208;
const menuHeight = 184;

const getStorageScope = (userId?: string | null, workspaceId?: string | null) =>
  userId && workspaceId ? `${userId}:${workspaceId}` : null;

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

const groupPinsByFolder = (pins: PinRecord[]) => {
  const rootPins: PinRecord[] = [];
  const folderPins = new Map<string, PinRecord[]>();

  for (const pin of pins) {
    const folderId = pin.folder_id ?? null;
    if (!folderId) {
      rootPins.push(pin);
      continue;
    }
    const list = folderPins.get(folderId) ?? [];
    list.push(pin);
    folderPins.set(folderId, list);
  }

  return { rootPins, folderPins };
};

const buildReorderPayload = (pins: PinRecord[], folders: PinFolder[]) => {
  const { rootPins, folderPins } = groupPinsByFolder(pins);
  const payload: Array<{ id: string; folder_id?: string | null; sort_order?: number }> = [];

  rootPins.forEach((pin, index) => {
    payload.push({ id: pin.id, folder_id: null, sort_order: index });
  });

  for (const folder of folders) {
    const items = folderPins.get(folder.id) ?? [];
    items.forEach((pin, index) => {
      payload.push({ id: pin.id, folder_id: folder.id, sort_order: index });
    });
  }

  return payload;
};

const resolvePinTarget = (pin: PinRecord) => getPinNavigationTarget(pin);

export const PinnedSidebarSection = () => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const {
    pins,
    folders,
    activePinId,
    isLoadingPins,
    reorderPins,
    reorderPinFolders,
    updatePinFolder,
    deletePinFolder,
    createPinFolder,
    unpinObject,
  } = usePins();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);
  const [optimisticPins, setOptimisticPins] = useState<PinRecord[] | null>(null);
  const [optimisticFolders, setOptimisticFolders] = useState<PinFolder[] | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const storageScope = getStorageScope(user?.id, activeWorkspaceId);
  const visiblePins = optimisticPins ?? pins;
  const visibleFolders = optimisticFolders ?? folders;

  useEffect(() => {
    if (!storageScope) {
      setIsCollapsed(false);
      return;
    }

    try {
      const raw = window.localStorage.getItem(`${PIN_SECTION_COLLAPSE_STORAGE_KEY}:${storageScope}`);
      setIsCollapsed(raw === '1');
    } catch {
      setIsCollapsed(false);
    }
  }, [storageScope]);

  useEffect(() => {
    if (!menuState) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
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

  const { rootPins, folderPins } = useMemo(() => groupPinsByFolder(visiblePins), [visiblePins]);
  const folderRows = useMemo(
    () => visibleFolders.map((folder) => ({ folder, pins: folderPins.get(folder.id) ?? [] })),
    [folderPins, visibleFolders]
  );

  const rootCount = rootPins.length;
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
      window.localStorage.setItem(`${PIN_SECTION_COLLAPSE_STORAGE_KEY}:${storageScope}`, nextValue ? '1' : '0');
    } catch {
      // ignore storage failures
    }
  };

  const openPin = (pin: PinRecord, openInNewWindow = false) => {
    const target = resolvePinTarget(pin);
    if (!target) return;
    const openMethod = openInNewWindow || target.openInNewWindow ? window.desktopWindow?.openModule : window.desktopWindow?.toggleModule;
    void openMethod?.(target.module as any, target.focus as any);
  };

  const handlePinDelete = async (pinId: string) => {
    setMenuState(null);
    await unpinObject(pinId);
  };

  const handlePinMoveToFolder = async (pinId: string, folderId: string | null) => {
    const currentPin = visiblePins.find((pin) => pin.id === pinId);
    if (!currentPin) return;

    const targetPins = visiblePins.filter((pin) => pin.id !== pinId);
    const movingPin: PinRecord = { ...currentPin, folder_id: folderId };
    const nextPins = new Map<string | null, PinRecord[]>();
    nextPins.set(null, [...targetPins.filter((pin) => !pin.folder_id)]);
    for (const folder of visibleFolders) {
      nextPins.set(folder.id, [...targetPins.filter((pin) => pin.folder_id === folder.id)]);
    }

    if (folderId) {
      const nextFolderItems = [...(nextPins.get(folderId) ?? []), movingPin];
      nextPins.set(folderId, nextFolderItems);
    } else {
      const rootItems = [...(nextPins.get(null) ?? []), movingPin];
      nextPins.set(null, rootItems);
    }

    const flattened: PinRecord[] = [];
    (nextPins.get(null) ?? []).forEach((pin, index) => {
      flattened.push({ ...pin, folder_id: null, sort_order: index });
    });
    for (const folder of visibleFolders) {
      (nextPins.get(folder.id) ?? []).forEach((pin, index) => {
        flattened.push({ ...pin, folder_id: folder.id, sort_order: index });
      });
    }

    setOptimisticPins(flattened);
    try {
      await reorderPins(buildReorderPayload(flattened, visibleFolders));
    } finally {
      setOptimisticPins(null);
    }
  };

  const handlePinReorder = async (draggedId: string, target: DropHint) => {
    const sourcePin = visiblePins.find((pin) => pin.id === draggedId);
    if (!sourcePin || !target) return;

    const grouped = groupPinsByFolder(visiblePins);
    const nextRoot = [...grouped.rootPins.filter((pin) => pin.id !== draggedId)];
    const nextFolderPins = new Map<string, PinRecord[]>();
    for (const folder of visibleFolders) {
      nextFolderPins.set(folder.id, [
        ...(grouped.folderPins.get(folder.id) ?? []).filter((pin) => pin.id !== draggedId),
      ]);
    }

    const insertIntoFolder = (folderId: string | null, pin: PinRecord, index: number) => {
      if (!folderId) {
        nextRoot.splice(index, 0, { ...pin, folder_id: null });
        return;
      }
      const list = nextFolderPins.get(folderId) ?? [];
      list.splice(index, 0, { ...pin, folder_id: folderId });
      nextFolderPins.set(folderId, list);
    };

    if (target.kind === 'pin') {
      const targetPin = visiblePins.find((pin) => pin.id === target.pinId);
      if (!targetPin) return;
      const targetFolderId = targetPin.folder_id ?? null;
      const folderList = targetFolderId ? nextFolderPins.get(targetFolderId) ?? [] : nextRoot;
      const targetIndex = folderList.findIndex((pin) => pin.id === target.pinId);
      const insertIndex = target.position === 'before' ? targetIndex : targetIndex + 1;
      insertIntoFolder(targetFolderId, sourcePin, insertIndex < 0 ? folderList.length : insertIndex);
    } else if (target.kind === 'folder') {
      insertIntoFolder(target.folderId, sourcePin, (nextFolderPins.get(target.folderId) ?? []).length);
    } else {
      insertIntoFolder(null, sourcePin, nextRoot.length);
    }

    const flattened: PinRecord[] = [];
    nextRoot.forEach((pin, index) => {
      flattened.push({ ...pin, folder_id: null, sort_order: index });
    });
    for (const folder of visibleFolders) {
      const folderItems = nextFolderPins.get(folder.id) ?? [];
      folderItems.forEach((pin, index) => {
        flattened.push({ ...pin, folder_id: folder.id, sort_order: index });
      });
    }

    setOptimisticPins(flattened);
    try {
      await reorderPins(buildReorderPayload(flattened, visibleFolders));
    } finally {
      setOptimisticPins(null);
    }
  };

  const handleFolderReorder = async (draggedFolderId: string, targetFolderId: string | null) => {
    const currentIndex = visibleFolders.findIndex((folder) => folder.id === draggedFolderId);
    if (currentIndex < 0) return;

    const nextFolders = [...visibleFolders];
    const targetIndex = targetFolderId
      ? nextFolders.findIndex((folder) => folder.id === targetFolderId)
      : nextFolders.length;
    const moved = nextFolders.splice(currentIndex, 1)[0];
    if (!moved) return;
    nextFolders.splice(targetIndex < 0 ? nextFolders.length : targetIndex, 0, moved);

    const reordered = nextFolders.map((folder, index) => ({
      ...folder,
      sort_order: index,
    }));
    setOptimisticFolders(reordered);
    try {
      await reorderPinFolders(reordered.map((folder) => ({ id: folder.id, sort_order: folder.sort_order })));
    } finally {
      setOptimisticFolders(null);
    }
  };

  const addFolder = async () => {
    const name = window.prompt('Folder name', 'New folder')?.trim();
    if (!name) return;
    await createPinFolder({ name });
  };

  const renameFolder = async (folder: PinFolder) => {
    const name = window.prompt('Folder name', folder.name)?.trim();
    if (!name || name === folder.name) return;
    await updatePinFolder(folder.id, { name });
  };

  const pinRowClass = (isActive: boolean, isDragging: boolean) =>
    `group grid h-8 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 text-left text-[12px] transition ${
      isActive ? sidebarTheme.selectedSurface : 'hover:bg-[var(--ledger-surface-muted)]'
    } ${isDragging ? 'opacity-60' : ''}`;

  const renderPinRow = (pin: PinRecord) => {
    const isActive = activePinId === pin.id;
    const isDragging = dragState?.kind === 'pin' && dragState.id === pin.id;
    const showBefore = dropHint?.kind === 'pin' && dropHint.pinId === pin.id && dropHint.position === 'before';
    const showAfter = dropHint?.kind === 'pin' && dropHint.pinId === pin.id && dropHint.position === 'after';

    return (
      <div key={pin.id} className="relative">
        {showBefore && <div className="absolute -top-0.5 left-2 right-2 h-px bg-[var(--ledger-accent)]" />}
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
              void handlePinReorder(draggedId, dropHint ?? { kind: 'pin', pinId: pin.id, position: 'after' });
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
          title={pin.subtitle ?? pin.title}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-secondary)]">
            {getPinIcon(pin)}
          </span>
          <span className="min-w-0 truncate text-[13px] text-[var(--ledger-text-primary)]">
            {pin.title}
          </span>
          <span className="flex items-center gap-0.5">
            {pin.destination.kind === 'teams' && (
              <span className="text-[10px] text-[var(--ledger-text-muted)]">Team</span>
            )}
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
        {showAfter && <div className="absolute -bottom-0.5 left-2 right-2 h-px bg-[var(--ledger-accent)]" />}
      </div>
    );
  };

  const renderFolderRows = () =>
    folderRows.map(({ folder, pins: folderPinsForRow }) => {
      const isFolderDragging = dragState?.kind === 'folder' && dragState.id === folder.id;
      const showFolderDrop = dropHint?.kind === 'folder' && dropHint.folderId === folder.id;
      const collapsed = folder.collapsed;

      return (
        <section
          key={folder.id}
          className={`group rounded-lg ${isFolderDragging ? 'opacity-70' : ''}`}
          onDragOver={(event) => {
            if (dragState?.kind !== 'pin' && dragState?.kind !== 'folder') return;
            event.preventDefault();
            setDropHint({ kind: 'folder', folderId: folder.id });
          }}
          onDrop={(event) => {
            event.preventDefault();
            const draggedId = event.dataTransfer.getData('text/plain') || dragState?.id;
            if (!draggedId) return;
            if (dragState?.kind === 'folder') {
              void handleFolderReorder(draggedId, folder.id);
              setDragState(null);
              setDropHint(null);
              return;
            }
            if (dragState?.kind === 'pin') {
              void handlePinMoveToFolder(draggedId, folder.id);
              setDragState(null);
              setDropHint(null);
            }
          }}
        >
          <div
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', folder.id);
              setDragState({ kind: 'folder', id: folder.id });
            }}
            onDragEnd={() => {
              setDragState(null);
              setDropHint(null);
            }}
            onClick={() => {
              void updatePinFolder(folder.id, { collapsed: !collapsed });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenuState({ type: 'folder', x: event.clientX, y: event.clientY, folderId: folder.id });
            }}
            className={`group flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-[12px] transition ${
              showFolderDrop ? 'bg-[var(--ledger-surface-hover)]' : 'hover:bg-[var(--ledger-surface-muted)]'
            }`}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--ledger-text-muted)]">
                <ChevronDown size={12} className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} />
              </span>
              <FolderOpen size={12} className="shrink-0 text-[var(--ledger-text-muted)]" />
              <span className="truncate text-[var(--ledger-text-secondary)]">{folder.name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[10px] text-[var(--ledger-text-muted)]">{folderPinsForRow.length}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuState({ type: 'folder', x: event.clientX, y: event.clientY, folderId: folder.id });
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ledger-text-muted)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                aria-label={`${folder.name} options`}
              >
                <MoreHorizontal size={12} />
              </button>
            </div>
          </div>
          {!collapsed ? (
            <div className="mt-1.5 space-y-0.5 pl-2">
              {folderPinsForRow.length > 0 ? (
                folderPinsForRow.map((pin) => renderPinRow(pin))
              ) : (
                <div className="rounded-lg border border-dashed border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-muted)]">
                  Drop pins here
                </div>
              )}
            </div>
          ) : null}
        </section>
      );
    });

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
            className={`shrink-0 text-[var(--ledger-text-muted)] transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
          />
        </span>
        <span className="flex items-center gap-1">
          {totalCount > 0 && (
            <span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">{totalCount}</span>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuState({
                type: 'header',
                x: event.clientX,
                y: event.clientY,
              });
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ledger-text-muted)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--ledger-surface-muted)] hover:text-[var(--ledger-text-primary)]"
            aria-label="Pinned actions"
          >
            <MoreHorizontal size={12} />
          </button>
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
            void handlePinMoveToFolder(draggedId, null);
            setDragState(null);
            setDropHint(null);
          }}
        >
          {rootCount > 0 ? (
            <div className="space-y-0.5">
              {dropHint?.kind === 'root' && <div className="mx-2 h-px bg-[var(--ledger-accent)]" />}
              {rootPins.map((pin) => renderPinRow(pin))}
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

          {renderFolderRows()}
        </div>
      ) : null}

      {menuState &&
        createPortal(
          <div
            ref={menuRef}
            className={`${sidebarTheme.menu} min-w-52`}
            style={{
              left: `${Math.max(8, Math.min(menuState.x, window.innerWidth - menuWidth - 8))}px`,
              top: `${Math.max(8, Math.min(menuState.y, window.innerHeight - menuHeight - 8))}px`,
            } as CSSProperties}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {menuState.type === 'header' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMenuState(null);
                    void addFolder();
                  }}
                  className={sidebarTheme.menuItem}
                >
                  <FolderPlus size={14} />
                  New folder
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuState(null);
                    persistCollapsed(!isCollapsed);
                  }}
                  className={sidebarTheme.menuItem}
                >
                  <ChevronDown size={14} />
                  {isCollapsed ? 'Expand section' : 'Collapse section'}
                </button>
              </>
            )}

            {menuState.type === 'pin' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const pin = visiblePins.find((item) => item.id === menuState.pinId);
                    if (pin) openPin(pin);
                    setMenuState(null);
                  }}
                  className={sidebarTheme.menuItemAccent}
                >
                  <Folder size={14} />
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const pin = visiblePins.find((item) => item.id === menuState.pinId);
                    if (pin) openPin(pin, true);
                    setMenuState(null);
                  }}
                  className={sidebarTheme.menuItem}
                >
                  <FolderOpen size={14} />
                  Open in new window
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuState({ ...menuState, type: 'move' });
                  }}
                  className={sidebarTheme.menuItem}
                >
                  <FolderPlus size={14} />
                  Move to folder
                </button>
                <button
                  type="button"
                  onClick={() => handlePinDelete(menuState.pinId)}
                  className={sidebarTheme.menuItem}
                >
                  <PinOff size={14} />
                  Unpin
                </button>
              </>
            )}

            {menuState.type === 'folder' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const folder = visibleFolders.find((item) => item.id === menuState.folderId);
                    if (folder) void renameFolder(folder);
                    setMenuState(null);
                  }}
                  className={sidebarTheme.menuItem}
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuState(null);
                    void addFolder();
                  }}
                  className={sidebarTheme.menuItem}
                >
                  <FolderPlus size={14} />
                  New folder
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const folder = visibleFolders.find((item) => item.id === menuState.folderId);
                    if (!folder) return;
                    const rootItems = visiblePins.filter((pin) => !pin.folder_id);
                    const folderItems = visiblePins.filter((pin) => pin.folder_id === folder.id);
                    const nextPins: PinRecord[] = [];
                    rootItems.forEach((pin, index) => {
                      nextPins.push({ ...pin, folder_id: null, sort_order: index });
                    });
                    folderItems.forEach((pin, index) => {
                      nextPins.push({ ...pin, folder_id: null, sort_order: rootItems.length + index });
                    });
                    visibleFolders
                      .filter((entry) => entry.id !== folder.id)
                      .forEach((entry) => {
                        const items = visiblePins.filter((pin) => pin.folder_id === entry.id);
                        items.forEach((pin, index) => {
                          nextPins.push({ ...pin, folder_id: entry.id, sort_order: index });
                        });
                      });
                    setOptimisticPins(nextPins);
                    try {
                      await reorderPins(buildReorderPayload(nextPins, visibleFolders));
                    } finally {
                      setOptimisticPins(null);
                    }
                    setMenuState(null);
                  }}
                  className={sidebarTheme.menuItem}
                >
                  Move all to root
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuState(null);
                    void deletePinFolder(menuState.folderId);
                  }}
                  className={sidebarTheme.menuItemDanger}
                >
                  Delete folder
                </button>
              </>
            )}

            {menuState.type === 'move' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void handlePinMoveToFolder(menuState.pinId, null);
                    setMenuState(null);
                  }}
                  className={sidebarTheme.menuItem}
                >
                  Root
                </button>
                <div className="my-1 h-px bg-[color:var(--ledger-border-subtle)]" />
                {visibleFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => {
                      void handlePinMoveToFolder(menuState.pinId, folder.id);
                      setMenuState(null);
                    }}
                    className={sidebarTheme.menuItem}
                  >
                    {folder.name}
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body
        )}
    </section>
  );
};
