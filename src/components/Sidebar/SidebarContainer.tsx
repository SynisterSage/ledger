import { useEffect, useMemo, useState, useRef } from 'react';
import { useSidebar } from '../../context/SidebarContext';
import { MinimizedSidebar } from './MinimizedSidebar';
import { ExpandedSidebar } from './ExpandedSidebar';
import { CollapsedSidebar } from './CollapsedSidebar';
import {
  getSidebarMaterialAlpha,
  getSidebarNativeMacTintAlpha,
} from '../../theme/sidebarMaterial';

export const SidebarContainer = ({ browserMode = false }: { browserMode?: boolean }) => {
  const {
    state,
    isVisible,
    isExpanded,
    position,
    opacity,
    effectiveFrostedBackground,
    transparencyOverrideActive,
    materialEngine,
    materialRequestedEngine,
    materialFallbackReason,
    nativeMaterialActive,
    materialMacVibrancy,
    materialMacVisualEffectState,
    reduceMotion,
    autoHide,
    collapseSidebar,
    restoreSidebarView,
    setFloatingPosition: saveFloatingPosition,
    isHydrated,
    workspaceShellLayout,
  } = useSidebar();
  const [isHovered, setIsHovered] = useState(false);
  const suppressAutoHideExpandRef = useRef(false);
  const suppressAutoHideResetTimerRef = useRef<number | null>(null);
  const autoHideFadeTimerRef = useRef<number | null>(null);
  const autoHideCollapseTimerRef = useRef<number | null>(null);
  const [isAutoHideFading, setIsAutoHideFading] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const isWindowsPlatform =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
  const AUTO_HIDE_DELAY_MS = 3000;
  const AUTO_HIDE_FADE_MS = 300;
  const effectivePosition = browserMode && position === 'floating' ? 'left' : position;
  const isFloating = !browserMode && effectivePosition === 'floating';
  const isHorizontal = effectivePosition === 'top' || effectivePosition === 'bottom';
  const isFullscreenAttachedShell = workspaceShellLayout.shellFullscreen && state !== 'fullscreen';
  const motionDurationMs = reduceMotion ? 0 : 160;
  const motionClass = reduceMotion
    ? ''
    : 'transition-[width,height,opacity,transform] duration-[100ms] ease-[cubic-bezier(0.22,1,0.36,1)]';
  const targetContentView = useMemo(() => ({ state, isExpanded }), [state, isExpanded]);
  const [contentView, setContentView] = useState(targetContentView);
  const contentSwapTimerRef = useRef<number | null>(null);
  const lastPositionRef = useRef(effectivePosition);
  const didMountRef = useRef(false);
  const introFrameRef = useRef<number | null>(null);
  const hasPlayedSidebarIntroRef = useRef(false);
  const [isIntroVisible, setIsIntroVisible] = useState(false);
  const materialRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleShutdownState = (event: Event) => {
      const active = (event as CustomEvent<{ active?: boolean }>).detail?.active === true;
      setIsShuttingDown(active);
    };
    window.addEventListener('ledger:shutdown-state', handleShutdownState);
    return () => window.removeEventListener('ledger:shutdown-state', handleShutdownState);
  }, []);

  useEffect(() => {
    if (!isHydrated || !isVisible || state === 'fullscreen' || hasPlayedSidebarIntroRef.current) {
      return;
    }

    if (reduceMotion) {
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
  }, [isHydrated, isVisible, reduceMotion, state]);

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
    const positionChanged = lastPositionRef.current !== effectivePosition;
    lastPositionRef.current = effectivePosition;

    if (contentSwapTimerRef.current !== null) {
      window.clearTimeout(contentSwapTimerRef.current);
      contentSwapTimerRef.current = null;
    }

    const isOpeningExpanded = state === 'expanded' && targetContentView.state === 'expanded';
    if (!didMountRef.current || reduceMotion || positionChanged || !isOpeningExpanded) {
      didMountRef.current = true;
      setContentView(targetContentView);
      return;
    }

    // Let the shell resize first; mounting expanded content during the first frame is the slow path.
    contentSwapTimerRef.current = window.setTimeout(() => {
      setContentView(targetContentView);
      contentSwapTimerRef.current = null;
    }, 110);
  }, [effectivePosition, reduceMotion, state, targetContentView]);

  const shellSizeClasses =
    state === 'expanded'
      ? isHorizontal
        ? 'w-auto h-[144px]'
        : 'w-64 h-full'
      : isExpanded
      ? isHorizontal
        ? 'w-auto h-[60px]'
        : 'w-14 h-full'
      : isHorizontal
        ? 'w-auto h-[60px]'
        : 'w-14 h-14';
  const isNativeMacMaterial = materialEngine === 'native-macos';
  const isRendererMaterial = materialEngine === 'renderer';
  const shellRadiusClass = browserMode
    ? 'rounded-none'
    : isFullscreenAttachedShell && effectivePosition === 'left'
      ? 'rounded-l-[var(--ledger-window-radius)] rounded-r-none'
      : isFullscreenAttachedShell && effectivePosition === 'right'
      ? 'rounded-r-[var(--ledger-window-radius)] rounded-l-none'
      : isFullscreenAttachedShell && effectivePosition === 'top'
      ? 'rounded-t-[var(--ledger-window-radius)] rounded-b-none'
      : isFullscreenAttachedShell && effectivePosition === 'bottom'
      ? 'rounded-b-[var(--ledger-window-radius)] rounded-t-none'
      : 'rounded-[var(--ledger-window-radius)]';
  const glassAttachmentClass =
    !isFloating && workspaceShellLayout.sidebarMode === 'attached'
      ? 'sidebar-glass-material--attached'
      : 'sidebar-glass-material--floating';
  const isAttachedRendererMaterial =
    !isFloating &&
    workspaceShellLayout.sidebarMode === 'attached' &&
    materialEngine === 'renderer';
  const materialAlpha = Math.max(
    0,
    isNativeMacMaterial
      ? getSidebarNativeMacTintAlpha(opacity)
      : getSidebarMaterialAlpha(opacity) -
          (isRendererMaterial && effectiveFrostedBackground ? 0.16 : 0)
  );
  const materialClass = `sidebar-glass-material ${glassAttachmentClass}${
    effectiveFrostedBackground ? ' sidebar-glass-material--frosted' : ''
  }${isAttachedRendererMaterial && effectiveFrostedBackground ? ' sidebar-glass-material--blur' : ''}`;

  useEffect(() => {
    const handleOpacityPreview = (
      _event: unknown,
      payload: { opacity?: unknown }
    ) => {
      const nextOpacity = Number(payload?.opacity);
      if (transparencyOverrideActive || !Number.isFinite(nextOpacity) || !materialRef.current) return;

      const nextAlpha = Math.max(
        0,
        isNativeMacMaterial
          ? getSidebarNativeMacTintAlpha(nextOpacity)
          : getSidebarMaterialAlpha(nextOpacity) -
              (isRendererMaterial && effectiveFrostedBackground ? 0.16 : 0)
      );
      materialRef.current.style.setProperty('--sidebar-material-alpha', String(nextAlpha));
    };

    window.ledgerIpc?.events?.onSidebarOpacityPreview(handleOpacityPreview);
    return () => {
      window.ledgerIpc?.events?.offSidebarOpacityPreview(handleOpacityPreview);
    };
  }, [
    effectiveFrostedBackground,
    isAttachedRendererMaterial,
    isNativeMacMaterial,
    isRendererMaterial,
    transparencyOverrideActive,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV || !materialRef.current) return;
    const material = materialRef.current;
    const computed = window.getComputedStyle(material);
    const content = material.parentElement?.querySelector('.sidebar-glass-content');
    const contentComputed = content ? window.getComputedStyle(content) : null;
    const hasSameRendererBackdrop = Boolean(
      document.querySelector('[data-ledger-renderer-backdrop]')
    );
    const diagnostics = {
      requestedEngine: materialRequestedEngine,
      resolvedEngine: materialEngine,
      attached: isAttachedRendererMaterial,
      sidebarMode: workspaceShellLayout.sidebarMode,
      effectiveFrostedBackground,
      reduceTransparencyOverride: transparencyOverrideActive,
      nativeMaterialEnabled: nativeMaterialActive,
      requestedMacVibrancy: materialMacVibrancy,
      visualEffectState: materialMacVisualEffectState,
      backdropFilter:
        computed.backdropFilter ||
        (computed as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter ||
        'none',
      rendererBackdropContentAvailable: hasSameRendererBackdrop,
      materialCoveredByOpaqueLayer:
        contentComputed?.opacity === '1' &&
        contentComputed.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        contentComputed.backgroundColor !== 'transparent',
      materialRgb: computed.getPropertyValue('--sidebar-material-rgb').trim(),
      materialAlpha: computed.getPropertyValue('--sidebar-material-alpha').trim(),
      computedBackgroundColor: computed.backgroundColor,
      blurRadius: computed.getPropertyValue('--sidebar-frost-blur').trim() || '10px',
      clipping: computed.overflow,
      fallbackReason: materialFallbackReason,
      reason: transparencyOverrideActive
        ? 'Reduce Transparency or forced colors resolved the sidebar to solid.'
        : nativeMaterialActive
        ? 'Native material is active; CSS backdrop-filter is intentionally disabled.'
        : !isAttachedRendererMaterial
        ? 'Floating renderer material cannot sample arbitrary desktop content.'
        : !hasSameRendererBackdrop
        ? 'No same-renderer Chromium content is available behind the material layer.'
        : effectiveFrostedBackground
        ? 'Attached renderer frost is active with one backdrop-filter layer and a 0.05 tint-alpha reduction.'
        : 'Frosted background is disabled; the renderer uses the normal translucent tint.'
    };
    (window as unknown as { __LEDGER_SIDEBAR_MATERIAL_DIAGNOSTICS__?: unknown })
      .__LEDGER_SIDEBAR_MATERIAL_DIAGNOSTICS__ = diagnostics;
  }, [
    effectiveFrostedBackground,
    isAttachedRendererMaterial,
    materialEngine,
    materialFallbackReason,
    materialMacVibrancy,
    materialMacVisualEffectState,
    materialRequestedEngine,
    nativeMaterialActive,
    opacity,
    transparencyOverrideActive,
    workspaceShellLayout.sidebarMode,
  ]);

  if (!isVisible || state === 'fullscreen') return null;

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
    currentPosition: { x: number; y: number };
  } | null>(null);

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
      currentPosition: {
        x: (actualPos as { x: number; y: number }).x,
        y: (actualPos as { x: number; y: number }).y,
      },
    };

    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging || !isFloating) return;

    const handleMove = () => {
      const state = dragStateRef.current;
      if (!state) return;

      void window.desktopWindow
        ?.updateFloatingDrag()
        .then((bounds) => {
          if (!bounds || !dragStateRef.current) return;
          dragStateRef.current.currentPosition = { x: bounds.x, y: bounds.y };
        })
        .catch(() => {
          // No-op outside Electron.
        });
    };

    const handleUp = async () => {
      const finalPosition = dragStateRef.current?.currentPosition;
      setIsDragging(false);
      dragStateRef.current = null;

      if (isWindowsPlatform && window.desktopWindow?.finishFloatingDrag) {
        try {
          const currentBounds = await window.desktopWindow.finishFloatingDrag();
          if (
            currentBounds &&
            typeof currentBounds.x === 'number' &&
            typeof currentBounds.y === 'number'
          ) {
            saveFloatingPosition({ x: currentBounds.x, y: currentBounds.y });
            return;
          }
        } catch {
          // Fall back to the last dragged position if the native finish call fails.
        }
      }

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
      : reduceMotion
      ? 'translate3d(0, 0, 0) scale(1)'
      : isFloating
      ? 'translate3d(0, 10px, 0) scale(0.985)'
      : effectivePosition === 'left'
      ? 'translate3d(-12px, 0, 0) scale(0.985)'
      : effectivePosition === 'right'
      ? 'translate3d(12px, 0, 0) scale(0.985)'
      : effectivePosition === 'top'
      ? 'translate3d(0, -12px, 0) scale(0.985)'
      : 'translate3d(0, 12px, 0) scale(0.985)',
    width: isHorizontal
      ? state === 'expanded'
        ? 'min(1120px, calc(100vw - 32px))'
        : 'min(1120px, calc(100vw - 32px))'
      : undefined,
    height: isHorizontal ? (state === 'expanded' ? '144px' : '60px') : undefined,
    backgroundColor: undefined,
    ['--sidebar-material-alpha' as string]: (() => {
      if (transparencyOverrideActive) return 1;
      return materialAlpha;
    })(),
    contain: 'layout style',
    transitionProperty:
      isDragging && isFloating
        ? 'opacity'
        : isHorizontal
        ? 'opacity'
        : 'opacity, transform, width, height',
    transitionDuration: shouldDisableShellMotion ? '0ms' : `${motionDurationMs}ms`,
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
  };

  const renderSidebarContent = (
    currentState: Exclude<typeof state, 'fullscreen'>,
    currentIsExpanded: boolean
  ) => {
    return (
      <div className="h-full w-full">
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
            <MinimizedSidebar
              onDragHandleMouseDown={isFloating ? handleDragHandleStart : undefined}
            />
          </div>
        )}

        {currentState === 'minimized' && !currentIsExpanded && (
          <div className="h-full w-full">
            <CollapsedSidebar
              onDragHandleMouseDown={isFloating ? handleDragHandleStart : undefined}
            />
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
      className={`relative ${shellSizeClasses} ${browserMode ? 'web-sidebar-shell' : ''} ${
        reduceMotion || isHorizontal ? '' : motionClass
      } ${hydrationClass}`}
      data-frosted={effectiveFrostedBackground ? 'true' : 'false'}
      data-material-engine={materialEngine}
      data-reduce-motion={reduceMotion ? 'true' : 'false'}
      data-reduce-transparency={transparencyOverrideActive ? 'true' : 'false'}
    >
      <div className={`sidebar-glass-clip h-full w-full ${shellRadiusClass}`}>
        <div ref={materialRef} className={materialClass} aria-hidden="true" />
        <div className="sidebar-glass-content h-full w-full">
          {renderSidebarContent(
            contentView.state as Exclude<typeof state, 'fullscreen'>,
            contentView.isExpanded
          )}
          {isShuttingDown && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-[var(--ledger-surface-muted)]/92 text-sm font-medium text-[var(--ledger-text-primary)]">
              Shutting down
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
