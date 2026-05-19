import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type React from 'react';
import { useSidebar } from '../../context/SidebarContext';
import { Search, BarChart3, CalendarDays, Folder, StickyNote, Plus, ChevronUp, ChevronDown, LogOut } from 'lucide-react';
import { useSearch } from '../../context/SearchContext';
import { useAuthContext } from '../../context/AuthContext';

export const CollapsedSidebar = ({
  onDragHandleMouseDown,
}: {
  onDragHandleMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  const { restoreSidebarView, position } = useSidebar();
  const { openSearch } = useSearch();
  const { signOut } = useAuthContext();
  const isHorizontal = position === 'top' || position === 'bottom';
  const isTopDock = position === 'top';
  const ExpandChevron = isTopDock ? ChevronDown : ChevronUp;
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureStyle, setQuickCaptureStyle] = useState<React.CSSProperties | null>(null);
  const quickCaptureButtonRef = useRef<HTMLButtonElement | null>(null);
  const quickCapturePopoverRef = useRef<HTMLDivElement | null>(null);

  const handleClick = () => {
    restoreSidebarView();
  };

  const iconButtonClass =
    'inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-150 hover:bg-white/45 active:scale-95';

  useEffect(() => {
    if (!quickCaptureOpen || !quickCaptureButtonRef.current) {
      setQuickCaptureStyle(null);
      return;
    }

    const update = () => {
      const rect = quickCaptureButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const preferredWidth = 220;
      const gap = 10;
      const left = Math.max(12, Math.min(window.innerWidth - preferredWidth - 12, rect.left + rect.width / 2 - preferredWidth / 2));
      const top = isTopDock ? rect.bottom + gap : rect.top - gap;
      setQuickCaptureStyle({
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        transform: isTopDock ? 'none' : 'translateY(-100%)',
        width: `${preferredWidth}px`,
        zIndex: 30000,
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQuickCaptureOpen(false);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isTopDock, quickCaptureOpen]);

  useEffect(() => {
    if (!quickCaptureOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (quickCaptureButtonRef.current?.contains(target)) return;
      if (quickCapturePopoverRef.current?.contains(target)) return;
      setQuickCaptureOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [quickCaptureOpen]);

  return (
    <div
      className={`flex h-full w-full ${
        isHorizontal
          ? 'flex-row items-center justify-between px-4 py-3'
          : 'items-center justify-center'
      }`}
      onMouseDown={(e) => {
        if (!onDragHandleMouseDown) return;
        if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]'))
          return;
        onDragHandleMouseDown(e);
      }}
      style={{ cursor: onDragHandleMouseDown ? 'grab' : 'auto' }}
    >
      {isHorizontal ? (
        <>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClick}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Expand sidebar"
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl bg-transparent transition-colors duration-200 ease-out hover:bg-white/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
            >
              <img src="./logo-color.svg" alt="Ledger" className="block h-8 w-8" draggable={false} />
            </button>

            <button
              aria-label="Open search"
              onClick={() => {
                restoreSidebarView();
                window.setTimeout(() => {
                  openSearch();
                }, 180);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Search size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              aria-label="Open dashboard"
              onClick={() => window.desktopWindow?.toggleModule('dashboard')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <BarChart3 size={18} />
            </button>
            <button
              aria-label="Open calendar"
              onClick={() => window.desktopWindow?.toggleModule('calendar')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <CalendarDays size={18} />
            </button>
            <button
              aria-label="Open projects"
              onClick={() => window.desktopWindow?.toggleModule('projects')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Folder size={18} />
            </button>
            <button
              aria-label="Open notes"
              onClick={() => window.desktopWindow?.toggleModule('notes')}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <StickyNote size={18} />
            </button>
            <button
              aria-label="Open quick capture"
              ref={quickCaptureButtonRef}
              onClick={() => setQuickCaptureOpen((current) => !current)}
              onMouseDown={(e) => e.stopPropagation()}
              className={iconButtonClass}
            >
              <Plus size={18} />
            </button>
            <button
              onClick={handleClick}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Expand sidebar"
              className={iconButtonClass}
            >
              <ExpandChevron size={18} />
            </button>
            <button onClick={signOut} onMouseDown={(e) => e.stopPropagation()} className={iconButtonClass}>
              <LogOut size={18} />
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Expand sidebar"
          className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-transparent transition-colors duration-200 ease-out hover:bg-white/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
        >
          <img src="./logo-color.svg" alt="Ledger" className="block h-8 w-8" draggable={false} />
        </button>
      )}
      {quickCaptureOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={quickCapturePopoverRef}
              style={quickCaptureStyle ?? undefined}
              className="rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                  Quick Capture
                </p>
                <button
                  type="button"
                  onClick={() => setQuickCaptureOpen(false)}
                  className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  onClick={() => window.desktopWindow?.toggleModule('quick-task')}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  Task
                </button>
                <button
                  onClick={() => window.desktopWindow?.toggleModule('quick-note')}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  Note
                </button>
                <button
                  onClick={() => window.desktopWindow?.toggleModule('quick-event')}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  Event
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};
