import { useEffect, useMemo, useState, useRef } from 'react';
import { useSidebar } from '../../context/SidebarContext';
import { MinimizedSidebar } from './MinimizedSidebar';
import { ExpandedSidebar } from './ExpandedSidebar';
import { CollapsedSidebar } from './CollapsedSidebar';

export const SidebarContainer = () => {
  const {
    state,
    isVisible,
    isExpanded,
    position,
    opacity,
    blur,
    autoHide,
    collapseSidebar,
    restoreSidebarView,
    setFloatingPosition: saveFloatingPosition,
    isHydrated,
  } = useSidebar();
  const [isHovered, setIsHovered] = useState(false);
  const suppressAutoHideExpandRef = useRef(false);
  const suppressAutoHideResetTimerRef = useRef<number | null>(null);
  const autoHideFadeTimerRef = useRef<number | null>(null);
  const autoHideCollapseTimerRef = useRef<number | null>(null);
  const [isAutoHideFading, setIsAutoHideFading] = useState(false);
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
  const AUTO_HIDE_DELAY_MS = 3000;
  const AUTO_HIDE_FADE_MS = 300;
  const isFloating = position === 'floating';
  const isHorizontal = position === 'top' || position === 'bottom';
  const isCollapsedIconMode = state === 'minimized' && !isExpanded;
  const motionDurationMs = prefersReducedMotion ? 0 : 100;
  const motionClass = prefersReducedMotion
    ? ''
    : 'transition-[width,height,opacity,transform] duration-[100ms] ease-[cubic-bezier(0.22,1,0.36,1)]';
  const targetContentView = useMemo(
    () => ({ state, isExpanded }),
    [state, isExpanded]
  );
  const [contentView, setContentView] = useState(targetContentView);
  const contentSwapTimerRef = useRef<number | null>(null);
  const lastPositionRef = useRef(position);
  const didMountRef = useRef(false);
  const introFrameRef = useRef<number | null>(null);
  const hasPlayedSidebarIntroRef = useRef(false);
  const [isIntroVisible, setIsIntroVisible] = useState(false);

  useEffect(() => {
    if (!isHydrated || !isVisible || state === 'fullscreen' || hasPlayedSidebarIntroRef.current) {
      return;
    }

    if (prefersReducedMotion) {
      hasPlayedSidebarIntroRef.current = true;
      setIsIntroVisible(true);
      return;
    }

    setIsIntroVisible(false);
    introFrameRef.current = window.requestAnimationFrame(() => {
      hasPlayedSidebarIntroRef.current = true;
      setIsIntroVisible(true);
      introFrameRef.current = null;
    });

    return () => {
      if (introFrameRef.current !== null) {
        window.cancelAnimationFrame(introFrameRef.current);
        introFrameRef.current = null;
      }
    };
  }, [isHydrated, isVisible, prefersReducedMotion, state]);

  useEffect(() => {
    if (!autoHide) {
      setIsHovered(false);
      if (suppressAutoHideResetTimerRef.current !== null) {
        window.clearTimeout(suppressAutoHideResetTimerRef.current);
        suppressAutoHideResetTimerRef.current = null;
      }
      if (autoHideFadeTimerRef.current !== null) {
        window.clearTimeout(autoHideFadeTimerRef.current);
        autoHideFadeTimerRef.current = null;
      }
      if (autoHideCollapseTimerRef.current !== null) {
        window.clearTimeout(autoHideCollapseTimerRef.current);
        autoHideCollapseTimerRef.current = null;
      }
      setIsAutoHideFading(false);
      return;
    }

    if (!isHovered && state !== 'fullscreen') {
      if (autoHideFadeTimerRef.current !== null) {
        window.clearTimeout(autoHideFadeTimerRef.current);
      }
      if (autoHideCollapseTimerRef.current !== null) {
        window.clearTimeout(autoHideCollapseTimerRef.current);
      }
      setIsAutoHideFading(false);
      autoHideFadeTimerRef.current = window.setTimeout(() => {
        setIsAutoHideFading(true);
        autoHideFadeTimerRef.current = null;
        autoHideCollapseTimerRef.current = window.setTimeout(() => {
          collapseSidebar();
          setIsAutoHideFading(false);
          autoHideCollapseTimerRef.current = null;
        }, AUTO_HIDE_FADE_MS);
      }, AUTO_HIDE_DELAY_MS);
    }
  }, [autoHide]);

  useEffect(() => {
    return () => {
      if (suppressAutoHideResetTimerRef.current !== null) {
        window.clearTimeout(suppressAutoHideResetTimerRef.current);
      }
      if (autoHideFadeTimerRef.current !== null) {
        window.clearTimeout(autoHideFadeTimerRef.current);
      }
      if (autoHideCollapseTimerRef.current !== null) {
        window.clearTimeout(autoHideCollapseTimerRef.current);
      }
      if (contentSwapTimerRef.current !== null) {
        window.clearTimeout(contentSwapTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const positionChanged = lastPositionRef.current !== position;
    lastPositionRef.current = position;

    if (contentSwapTimerRef.current !== null) {
      window.clearTimeout(contentSwapTimerRef.current);
      contentSwapTimerRef.current = null;
    }

    const isOpeningExpanded = state === 'expanded' && targetContentView.state === 'expanded';
    if (!didMountRef.current || prefersReducedMotion || positionChanged || !isOpeningExpanded) {
      didMountRef.current = true;
      setContentView(targetContentView);
      return;
    }

    // Let the shell resize first; mounting expanded content during the first frame is the slow path.
    contentSwapTimerRef.current = window.setTimeout(() => {
      setContentView(targetContentView);
      contentSwapTimerRef.current = null;
    }, 45);
  }, [position, prefersReducedMotion, state, targetContentView]);

  if (!isVisible || state === 'fullscreen') return null;

  const shellSizeClasses =
    state === 'expanded'
      ? isHorizontal
        ? 'w-auto h-[144px]'
        : 'w-80 h-full'
      : isExpanded
      ? isHorizontal
        ? 'w-auto h-[60px]'
        : 'w-16 h-full'
      : isHorizontal
      ? 'w-auto h-[60px]'
      : 'w-16 h-16';
  const shellRadiusClass = isCollapsedIconMode ? 'rounded-2xl' : 'rounded-3xl';
  const shellClipRadius = isCollapsedIconMode ? '16px' : '24px';
  const shellOverflowClass =
    state === 'minimized' && isExpanded ? 'overflow-visible' : 'overflow-hidden';
  const isGlassShell = state === 'expanded' || (state === 'minimized' && isExpanded);
  const platformClass =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')
      ? 'platform-windows'
      : typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
      ? 'platform-macos'
      : '';
  const shellSurfaceClass =
    isGlassShell
      ? blur
        ? `sidebar-glass ${platformClass}`
        : `sidebar-glass sidebar-glass--solid ${platformClass}`
      : isCollapsedIconMode
      ? 'sidebar-glass-icon'
      : 'border border-[rgba(255,255,255,0.55)] shadow-[0_10px_28px_rgba(15,23,42,0.16)] outline outline-[rgba(15,23,42,0.08)]';

  const scheduleAutoHideHide = () => {
    if (!autoHide) return;
    if (autoHideFadeTimerRef.current !== null) {
      window.clearTimeout(autoHideFadeTimerRef.current);
    }
    if (autoHideCollapseTimerRef.current !== null) {
      window.clearTimeout(autoHideCollapseTimerRef.current);
    }
    setIsAutoHideFading(false);
    autoHideFadeTimerRef.current = window.setTimeout(() => {
      setIsAutoHideFading(true);
      autoHideFadeTimerRef.current = null;
      autoHideCollapseTimerRef.current = window.setTimeout(() => {
        collapseSidebar();
        setIsAutoHideFading(false);
        autoHideCollapseTimerRef.current = null;
      }, AUTO_HIDE_FADE_MS);
    }, AUTO_HIDE_DELAY_MS);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    setIsAutoHideFading(false);
    if (autoHideFadeTimerRef.current !== null) {
      window.clearTimeout(autoHideFadeTimerRef.current);
      autoHideFadeTimerRef.current = null;
    }
    if (autoHideCollapseTimerRef.current !== null) {
      window.clearTimeout(autoHideCollapseTimerRef.current);
      autoHideCollapseTimerRef.current = null;
    }
    if (suppressAutoHideResetTimerRef.current !== null) {
      window.clearTimeout(suppressAutoHideResetTimerRef.current);
      suppressAutoHideResetTimerRef.current = null;
    }
    if (autoHide && state !== 'expanded' && !suppressAutoHideExpandRef.current) {
      restoreSidebarView();
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (suppressAutoHideResetTimerRef.current !== null) {
      window.clearTimeout(suppressAutoHideResetTimerRef.current);
    }
    suppressAutoHideResetTimerRef.current = window.setTimeout(() => {
      suppressAutoHideExpandRef.current = false;
      suppressAutoHideResetTimerRef.current = null;
    }, AUTO_HIDE_DELAY_MS);
    scheduleAutoHideHide();
  };

  const handleCollapseRequest = () => {
    if (autoHide) {
      suppressAutoHideExpandRef.current = true;
      setIsAutoHideFading(false);
      if (suppressAutoHideResetTimerRef.current !== null) {
        window.clearTimeout(suppressAutoHideResetTimerRef.current);
        suppressAutoHideResetTimerRef.current = null;
      }
      if (autoHideFadeTimerRef.current !== null) {
        window.clearTimeout(autoHideFadeTimerRef.current);
        autoHideFadeTimerRef.current = null;
      }
      if (autoHideCollapseTimerRef.current !== null) {
        window.clearTimeout(autoHideCollapseTimerRef.current);
        autoHideCollapseTimerRef.current = null;
      }
    }
  };

  // Floating mode drag handling - ONLY for ExpandedSidebar header
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{
    startScreenX: number;
    startScreenY: number;
    startLeft: number;
    startTop: number;
    currentPosition: { x: number; y: number };
  } | null>(null);
  const moveFloatingWindow = (nextPosition: { x: number; y: number }) => {
    void window.desktopWindow?.setFloatingPosition(nextPosition).catch(() => {
      // No-op outside Electron
    });
  };

  // Reset dragging state when floating mode is disabled
  useEffect(() => {
    if (!isFloating) {
      setIsDragging(false);
      dragStateRef.current = null;
    }
  }, [isFloating]);

  const handleDragHandleStart = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isFloating || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    // Get actual position from Electron to avoid drift
    const actualPos = await window.desktopWindow?.beginFloatingDrag().catch(() => null);

    if (!actualPos || !('x' in actualPos) || !('y' in actualPos)) {
      setIsDragging(false);
      return;
    }

    dragStateRef.current = {
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startLeft: (actualPos as { x: number; y: number }).x,
      startTop: (actualPos as { x: number; y: number }).y,
      currentPosition: {
        x: (actualPos as { x: number; y: number }).x,
        y: (actualPos as { x: number; y: number }).y,
      },
    };

    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging || !isFloating) return;

    const handleMove = (moveEvent: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      const dx = moveEvent.screenX - state.startScreenX;
      const dy = moveEvent.screenY - state.startScreenY;

      const nextPosition = {
        x: state.startLeft + dx,
        y: state.startTop + dy,
      };

      state.currentPosition = nextPosition;

      moveFloatingWindow(nextPosition);
    };

    const handleUp = async () => {
      const finalPosition = dragStateRef.current?.currentPosition;
      setIsDragging(false);
      dragStateRef.current = null;

      if (window.desktopWindow) {
        try {
          const dockedBounds = await window.desktopWindow.dockFloatingWindow();
          if (
            dockedBounds &&
            typeof dockedBounds.x === 'number' &&
            typeof dockedBounds.y === 'number'
          ) {
            saveFloatingPosition({ x: dockedBounds.x, y: dockedBounds.y });
            return;
          }
        } catch {
          // If docking fails, fall back to the last dragged position.
        }
      }

      if (finalPosition) {
        saveFloatingPosition(finalPosition);
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, isFloating]);

  // keep layout width/height but hide visually until hydration completes to avoid flashes
  const hydrationClass = isHydrated ? '' : 'opacity-0 pointer-events-none';
  const shouldDisableShellMotion = (isDragging && isFloating) || isHorizontal;

  const shellStyle: React.CSSProperties = {
    opacity: autoHide && !isHovered && isAutoHideFading ? 0 : 1,
    transform: isIntroVisible
      ? 'translate3d(0, 0, 0) scale(1)'
      : prefersReducedMotion
      ? 'translate3d(0, 0, 0) scale(1)'
      : isFloating
      ? 'translate3d(0, 10px, 0) scale(0.985)'
      : position === 'left'
      ? 'translate3d(-12px, 0, 0) scale(0.985)'
      : position === 'right'
      ? 'translate3d(12px, 0, 0) scale(0.985)'
      : position === 'top'
      ? 'translate3d(0, -12px, 0) scale(0.985)'
      : 'translate3d(0, 12px, 0) scale(0.985)',
    width: isHorizontal
      ? state === 'expanded'
        ? 'min(1120px, calc(100vw - 32px))'
        : 'min(1120px, calc(100vw - 32px))'
      : undefined,
    height: isHorizontal ? (state === 'expanded' ? '144px' : '60px') : undefined,
    backgroundColor:
      isGlassShell
        ? undefined
        : `rgba(248, 249, 251, ${Math.max(0.7, Math.min(0.95, opacity))})`,
    ['--sidebar-glass-white-alpha' as string]: Math.min(0.97, Math.max(0.9, opacity + 0.08)),
    ['--sidebar-glass-cream-alpha' as string]: Math.min(0.92, Math.max(0.84, opacity + 0.02)),
    ['--sidebar-glass-icon-alpha' as string]: Math.min(0.82, Math.max(0.72, opacity - 0.06)),
    clipPath: `inset(0 round ${shellClipRadius})`,
    contain: 'paint',
    transitionProperty:
      isDragging && isFloating
        ? 'opacity'
        : isHorizontal
        ? 'opacity'
        : 'opacity, transform, width, height',
    transitionDuration: shouldDisableShellMotion ? '0ms' : `${motionDurationMs}ms`,
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    willChange:
      shouldDisableShellMotion ? 'opacity' : 'width, height, opacity, transform',
  };

  const renderSidebarContent = (
    currentState: Exclude<typeof state, 'fullscreen'>,
    currentIsExpanded: boolean
  ) => {
    return (
      <div
        className="h-full w-full"
      >
        {currentState === 'expanded' && (
          <div className="h-full min-h-0 w-full">
            <ExpandedSidebar
              onDragHandleMouseDown={isFloating ? handleDragHandleStart : undefined}
              onCollapseRequest={handleCollapseRequest}
            />
          </div>
        )}

        {currentState === 'minimized' && currentIsExpanded && (
          <div className="h-full w-full">
            <MinimizedSidebar onDragHandleMouseDown={isFloating ? handleDragHandleStart : undefined} />
          </div>
        )}

        {currentState === 'minimized' && !currentIsExpanded && (
          <div className="h-full w-full">
            <CollapsedSidebar onDragHandleMouseDown={isFloating ? handleDragHandleStart : undefined} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={shellStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative ${shellOverflowClass} ${shellRadiusClass} ${shellSurfaceClass} ${shellSizeClasses} ${
        prefersReducedMotion || isHorizontal ? '' : motionClass
      } ${autoHide && !isHovered && !isDragging ? 'shadow-sm' : ''} ${hydrationClass}`}
    >
      {renderSidebarContent(
        contentView.state as Exclude<typeof state, 'fullscreen'>,
        contentView.isExpanded
      )}
    </div>
  );
};
