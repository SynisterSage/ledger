import React, {
  createContext,
  useContext,
  type CSSProperties,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  SIDEBAR_PREFERENCES_STORAGE_KEY,
  clampSidebarOpacity,
  loadSidebarPreferences,
  saveSidebarPreferences,
  type SidebarFloatingPosition,
  type SidebarDefaultState,
  type SidebarPosition,
  type SidebarPreferences,
} from '../config/sidebarPreferences';
import type {
  SidebarMaterialEngine,
  SidebarMaterialFallbackReason,
} from '../theme/sidebarMaterial';

export type SidebarState = 'minimized' | 'expanded' | 'fullscreen';
export type { SidebarMaterialEngine } from '../theme/sidebarMaterial';
export type ModuleView = 'dashboard' | 'calendar';
export type SidebarAttachmentMode = 'attached' | 'overlay';
const SETTINGS_STORAGE_KEY = 'ledger:settings:v1';
type WorkspaceShellKind =
  | 'new-tab'
  | 'circle'
  | 'dashboard'
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'teams'
  | 'settings'
  | 'inbox'
  | 'slack'
  | 'notifications';
type FloatingDockPayload = {
  isDocked?: boolean;
  isWorkspaceDocked?: boolean;
  workspaceDockAutoAttachSuppressed?: boolean;
  side?: SidebarPosition | null;
};

export type WorkspaceShellLayout = {
  sidebarPlacement: SidebarPosition;
  sidebarMode: SidebarAttachmentMode;
  sidebarSize: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  shellFullscreen: boolean;
  workspaceShellStyle: CSSProperties;
};

const workspaceShellKinds = new Set<WorkspaceShellKind>([
  'new-tab',
  'circle',
  'dashboard',
  'calendar',
  'notes',
  'projects',
  'teams',
  'settings',
  'inbox',
  'slack',
  'notifications',
]);

interface SidebarContextType {
  state: SidebarState;
  setState: (state: SidebarState) => void;
  toggleExpand: () => void;
  isExpanded: boolean;
  setIsExpanded: (isExpanded: boolean) => void;
  collapsedRestoreIsExpanded: boolean;
  isHidden: boolean;
  setIsHidden: (isHidden: boolean) => void;
  toggleHidden: () => void;
  isVisible: boolean;
  setIsVisible: (isVisible: boolean) => void;
  toggleVisibility: () => void;
  position: SidebarPosition;
  setPosition: (position: SidebarPosition) => void;
  opacity: number;
  setOpacity: (opacity: number) => void;
  frostedBackgroundEnabled: boolean;
  setFrostedBackgroundEnabled: (enabled: boolean) => void;
  effectiveFrostedBackground: boolean;
  systemPrefersReducedTransparency: boolean;
  transparencyOverrideActive: boolean;
  materialEngine: SidebarMaterialEngine;
  materialRequestedEngine: SidebarMaterialEngine;
  materialFallbackReason: SidebarMaterialFallbackReason;
  nativeMaterialActive: boolean;
  materialMacVibrancy: 'under-window' | 'sidebar' | 'hud' | null;
  materialMacVisualEffectState: 'followWindow' | 'active';
  reduceMotion: boolean;
  defaultState: SidebarDefaultState;
  setDefaultState: (defaultState: SidebarDefaultState) => void;
  alwaysOnTop: boolean;
  setAlwaysOnTop: (alwaysOnTop: boolean) => void;
  autoHide: boolean;
  setAutoHide: (autoHide: boolean) => void;
  setFloatingDockEnabled: (enabled: boolean) => void;
  setFloatingDockThreshold: (threshold: number) => void;
  collapseSidebar: () => void;
  collapseToRail: () => void;
  restoreSidebarView: () => void;
  floatingPosition: SidebarFloatingPosition;
  setFloatingPosition: (position: SidebarFloatingPosition) => void;
  isFloatingDocked: boolean;
  sidebarPreferences: SidebarPreferences;
  moduleView: ModuleView;
  setModuleView: (view: ModuleView) => void;
  focusDate: string | null;
  setFocusDate: (date: string | null) => void;
  isHydrated: boolean;
  workspaceShellLayout: WorkspaceShellLayout;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const isModuleWindow = new URLSearchParams(window.location.search).get('window') === 'module';
  const [sidebarPreferences, setSidebarPreferences] = useState<SidebarPreferences>(() =>
    loadSidebarPreferences()
  );
  const [isHydrated, setIsHydrated] = React.useState(false);
  const saveTimerRef = React.useRef<number | null>(null);
  const opacityFrameRef = React.useRef<number | null>(null);
  const pendingOpacityRef = React.useRef<number | null>(null);
  const didNormalizeFloatingStartupRef = React.useRef(false);
  const wasFloatingDockedRef = React.useRef(false);
  const [isFloatingDocked, setIsFloatingDocked] = React.useState(false);
  const [isWorkspaceFloatingDocked, setIsWorkspaceFloatingDocked] = React.useState(false);
  const [workspaceDockAutoAttachSuppressed, setWorkspaceDockAutoAttachSuppressed] =
    React.useState(false);
  const [shellFullscreen, setShellFullscreen] = useState(false);
  const [systemPrefersReducedTransparency, setSystemPrefersReducedTransparency] = useState(false);
  const [materialEngine, setMaterialEngine] = useState<SidebarMaterialEngine>('renderer');
  const [materialRequestedEngine, setMaterialRequestedEngine] =
    useState<SidebarMaterialEngine>('renderer');
  const [materialFallbackReason, setMaterialFallbackReason] =
    useState<SidebarMaterialFallbackReason>(null);
  const [nativeMaterialActive, setNativeMaterialActive] = useState(false);
  const [materialMacVibrancy, setMaterialMacVibrancy] = useState<
    'under-window' | 'sidebar' | 'hud' | null
  >(null);
  const [materialMacVisualEffectState, setMaterialMacVisualEffectState] =
    useState<'followWindow' | 'active'>('followWindow');
  const [forcedColorsActive, setForcedColorsActive] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(() => {
    let appPreference = false;
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as { reduceMotion?: unknown }) : null;
      appPreference = parsed?.reduceMotion === true;
    } catch {}
    const systemPreference =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return appPreference || systemPreference;
  });
  const [floatingDockSide, setFloatingDockSide] = useState<SidebarPosition | null>(null);
  const [state, setSidebarState] = React.useState<SidebarState>(() => {
    const prefs = loadSidebarPreferences();
    if (prefs.defaultState === 'expanded') return 'expanded';
    if (prefs.defaultState === 'collapsed') return 'minimized';
    return prefs.lastState === 'collapsed' ? 'minimized' : 'expanded';
  });
  const [moduleView, setModuleView] = React.useState<ModuleView>('dashboard');
  const [focusDate, setFocusDate] = React.useState<string | null>(null);

  useEffect(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveSidebarPreferences(sidebarPreferences);
      if (!isHydrated) setIsHydrated(true);
      saveTimerRef.current = null;
    }, 120);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [sidebarPreferences, isHydrated, isModuleWindow]);

  useEffect(() => {
    return () => {
      if (opacityFrameRef.current !== null) {
        window.cancelAnimationFrame(opacityFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const isMaterialEngine = (value: unknown): value is SidebarMaterialEngine =>
      value === 'solid' ||
      value === 'renderer' ||
      value === 'native-macos' ||
      value === 'native-windows-mica' ||
      value === 'native-windows-mica-alt' ||
      value === 'native-windows-acrylic';
    const handleMaterialState = (
      _event: unknown,
      payload: {
        requestedEngine?: unknown;
        resolvedEngine?: unknown;
        fallbackReason?: unknown;
        nativeMaterialActive?: unknown;
        requestedMacVibrancy?: unknown;
        visualEffectState?: unknown;
      }
    ) => {
      setMaterialEngine(isMaterialEngine(payload?.resolvedEngine) ? payload.resolvedEngine : 'renderer');
      setMaterialRequestedEngine(
        isMaterialEngine(payload?.requestedEngine) ? payload.requestedEngine : 'renderer'
      );
      setMaterialFallbackReason(
        typeof payload?.fallbackReason === 'string'
          ? (payload.fallbackReason as SidebarMaterialFallbackReason)
          : null
      );
      setNativeMaterialActive(payload?.nativeMaterialActive === true);
      setMaterialMacVibrancy(
        payload?.requestedMacVibrancy === 'under-window' ||
          payload?.requestedMacVibrancy === 'sidebar' ||
          payload?.requestedMacVibrancy === 'hud'
          ? payload.requestedMacVibrancy
          : null
      );
      setMaterialMacVisualEffectState(payload?.visualEffectState === 'active' ? 'active' : 'followWindow');
    };

    window.ledgerIpc?.events?.onSidebarMaterialState(handleMaterialState);
    void window.desktopWindow?.getSidebarMaterialState?.().then((payload) => {
      setMaterialEngine(isMaterialEngine(payload?.resolvedEngine) ? payload.resolvedEngine : 'renderer');
      setMaterialRequestedEngine(
        isMaterialEngine(payload?.requestedEngine) ? payload.requestedEngine : 'renderer'
      );
      setMaterialFallbackReason(
        typeof payload?.fallbackReason === 'string'
          ? (payload.fallbackReason as SidebarMaterialFallbackReason)
          : null
      );
      setNativeMaterialActive(payload?.nativeMaterialActive === true);
      setMaterialMacVibrancy(
        payload?.requestedMacVibrancy === 'under-window' ||
          payload?.requestedMacVibrancy === 'sidebar' ||
          payload?.requestedMacVibrancy === 'hud'
          ? payload.requestedMacVibrancy
          : null
      );
      setMaterialMacVisualEffectState(payload?.visualEffectState === 'active' ? 'active' : 'followWindow');
    }).catch(() => {
      setMaterialEngine('renderer');
      setMaterialRequestedEngine('renderer');
      setMaterialFallbackReason(null);
      setNativeMaterialActive(false);
      setMaterialMacVibrancy(null);
      setMaterialMacVisualEffectState('followWindow');
    });
    return () => {
      window.ledgerIpc?.events?.offSidebarMaterialState(handleMaterialState);
    };
  }, []);

  useEffect(() => {
    const handlePreferenceSync = (
      _event: unknown,
      nextPreferences: Partial<SidebarPreferences>
    ) => {
      let didChange = false;

      setSidebarPreferences((current) => {
        const mergedPreferences = {
          ...current,
          ...nextPreferences,
        };

        didChange = JSON.stringify(mergedPreferences) !== JSON.stringify(current);

        return didChange ? mergedPreferences : current;
      });

      if (!didChange) return;
    };

    window.ledgerIpc?.events?.onSidebarPreferencesUpdated(handlePreferenceSync);
    return () => {
      window.ledgerIpc?.events?.offSidebarPreferencesUpdated(handlePreferenceSync);
    };
  }, [state]);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== SIDEBAR_PREFERENCES_STORAGE_KEY) return;

      const nextPreferences = loadSidebarPreferences();
      setSidebarPreferences(nextPreferences);

      if (state !== 'fullscreen') {
        setSidebarState(nextPreferences.lastState === 'collapsed' ? 'minimized' : 'expanded');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [state]);

  useEffect(() => {
    const handleAccessibilityState = (
      _event: unknown,
      payload: { prefersReducedTransparency?: unknown }
    ) => {
      setSystemPrefersReducedTransparency(payload?.prefersReducedTransparency === true);
    };

    window.ledgerIpc?.events?.onSidebarAccessibilityUpdated(handleAccessibilityState);
    void window.desktopWindow?.getSidebarAccessibilityState?.().then((payload) => {
      setSystemPrefersReducedTransparency(payload?.prefersReducedTransparency === true);
    }).catch(() => {
      // Browser development mode and older preload bridges keep the false fallback.
    });
    return () => {
      window.ledgerIpc?.events?.offSidebarAccessibilityUpdated(handleAccessibilityState);
    };
  }, []);

  useEffect(() => {
    const readAppReduceMotion = () => {
      try {
        const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as { reduceMotion?: unknown }) : null;
        return parsed?.reduceMotion === true;
      } catch {
        return false;
      }
    };
    const mediaQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const updateReduceMotion = () => {
      setReduceMotion(Boolean(readAppReduceMotion() || mediaQuery?.matches));
    };
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === SETTINGS_STORAGE_KEY) updateReduceMotion();
    };

    updateReduceMotion();
    window.addEventListener('storage', handleStorageChange);
    if (mediaQuery?.addEventListener) mediaQuery.addEventListener('change', updateReduceMotion);
    else mediaQuery?.addListener(updateReduceMotion);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      if (mediaQuery?.removeEventListener) {
        mediaQuery.removeEventListener('change', updateReduceMotion);
      } else {
        mediaQuery?.removeListener(updateReduceMotion);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(forced-colors: active)');
    const updateForcedColors = () => setForcedColorsActive(mediaQuery.matches);
    updateForcedColors();
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', updateForcedColors);
    else mediaQuery.addListener(updateForcedColors);
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', updateForcedColors);
      } else {
        mediaQuery.removeListener(updateForcedColors);
      }
    };
  }, []);

  useEffect(() => {
    if (didNormalizeFloatingStartupRef.current) return;
    if (!isHydrated) return;
    if (sidebarPreferences.position !== 'floating') return;
    if (state !== 'minimized' && sidebarPreferences.lastState !== 'collapsed') {
      didNormalizeFloatingStartupRef.current = true;
      return;
    }

    didNormalizeFloatingStartupRef.current = true;
    setSidebarState('minimized');
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: true,
      collapsedRestoreView: 'expanded',
      isExpanded: true,
      lastState: 'collapsed',
    }));
  }, [isHydrated, sidebarPreferences.lastState, sidebarPreferences.position, state]);

  useEffect(() => {
    const applyFloatingDockPayload = (payload: FloatingDockPayload | null | undefined) => {
      const nextIsDocked = Boolean(payload?.isDocked);
      const nextIsWorkspaceDocked = Boolean(payload?.isWorkspaceDocked);
      const nextWorkspaceDockAutoAttachSuppressed =
        Boolean(payload?.workspaceDockAutoAttachSuppressed);
      const nextSide =
        payload && typeof (payload as { side?: unknown }).side === 'string'
          ? ((payload as { side?: unknown }).side as SidebarPosition)
          : null;
      const wasDocked = wasFloatingDockedRef.current;

      wasFloatingDockedRef.current = nextIsDocked;
      setIsFloatingDocked(nextIsDocked);
      setIsWorkspaceFloatingDocked(nextIsWorkspaceDocked);
      setWorkspaceDockAutoAttachSuppressed(nextWorkspaceDockAutoAttachSuppressed);
      setFloatingDockSide(nextIsDocked ? nextSide ?? floatingDockSide : null);

      if (
        wasDocked &&
        !nextIsDocked &&
        sidebarPreferences.position === 'floating' &&
        state === 'minimized'
      ) {
        setSidebarPreferences((current) => ({
          ...current,
          collapsedRestoreIsExpanded: true,
          collapsedRestoreView: 'expanded',
          isExpanded: true,
          lastState: 'collapsed',
        }));
      }
    };

    const handleFloatingDockChanged = (_event: unknown, payload: FloatingDockPayload) => {
      applyFloatingDockPayload(payload);
    };

    void window.desktopWindow
      ?.getFloatingDockState?.()
      .then(applyFloatingDockPayload)
      .catch(() => {
        // Older desktop builds may not expose the dock-state read API.
      });

    window.ledgerIpc?.events?.onSidebarFloatingDockChanged(handleFloatingDockChanged);
    return () => {
      window.ledgerIpc?.events?.offSidebarFloatingDockChanged(handleFloatingDockChanged);
    };
  }, [floatingDockSide, sidebarPreferences.position, state]);

  useEffect(() => {
    const handleModuleFullscreenState = (
      _event: unknown,
      payload: { kind?: string; isFullscreen?: boolean } | null
    ) => {
      if (payload?.kind && !workspaceShellKinds.has(payload.kind as WorkspaceShellKind)) {
        return;
      }
      setShellFullscreen(Boolean(payload?.isFullscreen));
    };

    window.ledgerIpc?.events?.onModuleFullscreenStateChanged(handleModuleFullscreenState);
    return () => {
      window.ledgerIpc?.events?.offModuleFullscreenStateChanged(handleModuleFullscreenState);
    };
  }, []);

  useEffect(() => {
    const handleSidebarStateChanged = (
      _event: unknown,
      payload: { state?: SidebarState } | null
    ) => {
      if (!payload?.state) return;
      setSidebarState(payload.state);
    };

    window.ledgerIpc?.events?.onSidebarStateChanged(handleSidebarStateChanged);
    return () => {
      window.ledgerIpc?.events?.offSidebarStateChanged(handleSidebarStateChanged);
    };
  }, []);

  useEffect(() => {
    const handleModuleStateChanged = (
      _event: unknown,
      payload: { kind?: string; state?: 'minimized' | 'closed' } | null
    ) => {
      if (payload?.state !== 'closed') return;
      if (!shellFullscreen) return;
      if (!payload?.kind || !workspaceShellKinds.has(payload.kind as WorkspaceShellKind)) {
        return;
      }

      setShellFullscreen(false);
      collapseSidebar();
    };

    window.ledgerIpc?.events?.onModuleStateChanged(handleModuleStateChanged);
    return () => {
      window.ledgerIpc?.events?.offModuleStateChanged(handleModuleStateChanged);
    };
  }, [collapseSidebar, shellFullscreen]);

  const toggleExpand = () => {
    setState(state === 'expanded' ? 'minimized' : 'expanded');
  };

  const setState = (nextState: SidebarState) => {
    setSidebarState(nextState);
    if (nextState === 'fullscreen') return;

    setSidebarPreferences((current) => ({
      ...current,
      isExpanded: nextState === 'expanded',
      lastState: nextState === 'expanded' ? 'expanded' : 'collapsed',
    }));
  };

  const setIsExpanded = (isExpanded: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: isExpanded
        ? current.collapsedRestoreIsExpanded
        : current.isExpanded,
      isExpanded,
    }));
  };

  function collapseSidebar() {
    const nextRestoreView: SidebarPreferences['collapsedRestoreView'] =
      state === 'expanded' ? 'expanded' : sidebarPreferences.isExpanded ? 'rail' : 'collapsed';
    setSidebarState('minimized');
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: current.isExpanded,
      collapsedRestoreView: nextRestoreView,
      isExpanded: false,
      lastState: 'collapsed',
    }));
  }

  const collapseToRail = () => {
    setSidebarState('minimized');
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: true,
      collapsedRestoreView: 'expanded',
      isExpanded: true,
      lastState: 'collapsed',
    }));
  };

  const restoreSidebarView = () => {
    const restoreView = sidebarPreferences.collapsedRestoreView;

    if (restoreView === 'expanded') {
      setSidebarState('expanded');
      setSidebarPreferences((current) => ({
        ...current,
        isExpanded: true,
        lastState: 'expanded',
      }));
      return;
    }

    setSidebarState('minimized');
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: restoreView === 'rail',
      isExpanded: restoreView === 'rail',
      lastState: 'collapsed',
    }));
  };

  const setIsHidden = (isHidden: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      isHidden,
    }));
  };

  const toggleHidden = () => {
    setSidebarPreferences((current) => ({
      ...current,
      isHidden: !current.isHidden,
    }));
  };

  const setIsVisible = (isVisible: boolean) => {
    setIsHidden(!isVisible);
  };

  const toggleVisibility = () => {
    toggleHidden();
  };

  const setPosition = (position: SidebarPosition) => {
    setSidebarPreferences((current) => ({
      ...current,
      position,
    }));
  };

  const setOpacity = (opacity: number) => {
    const clampedOpacity = clampSidebarOpacity(opacity);
    pendingOpacityRef.current = clampedOpacity;

    if (opacityFrameRef.current !== null) return;

    const applyPendingOpacity = () => {
      opacityFrameRef.current = null;
      const nextOpacity = pendingOpacityRef.current;
      pendingOpacityRef.current = null;
      if (nextOpacity === null) return;

      setSidebarPreferences((current) =>
        current.opacity === nextOpacity ? current : { ...current, opacity: nextOpacity }
      );
    };

    if (typeof window.requestAnimationFrame === 'function') {
      opacityFrameRef.current = window.requestAnimationFrame(applyPendingOpacity);
    } else {
      applyPendingOpacity();
    }
  };

  const setFrostedBackgroundEnabled = (enabled: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      frostedBackgroundEnabled: enabled,
    }));
  };

  const setDefaultState = (defaultState: SidebarDefaultState) => {
    setSidebarPreferences((current) => ({
      ...current,
      defaultState,
    }));
  };

  const setAlwaysOnTop = (alwaysOnTop: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      alwaysOnTop,
    }));
  };

  const setAutoHide = (autoHide: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      autoHide,
    }));
  };

  const setFloatingDockEnabled = (floatingDockEnabled: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      floatingDockEnabled,
    }));
  };

  const setFloatingDockThreshold = (floatingDockThreshold: number) => {
    const clamped = Math.max(8, Math.min(80, floatingDockThreshold));
    setSidebarPreferences((current) => ({
      ...current,
      floatingDockThreshold: clamped,
    }));
  };

  const setFloatingPosition = (floatingPosition: SidebarFloatingPosition) => {
    setSidebarPreferences((current) => ({
      ...current,
      floatingPosition,
    }));
  };

  const isSidebarVisible = !sidebarPreferences.isHidden;
  const transparencyOverrideActive = systemPrefersReducedTransparency || forcedColorsActive;
  const effectiveFrostedBackground =
    sidebarPreferences.frostedBackgroundEnabled && !transparencyOverrideActive;
  const workspaceShellLayout = useMemo<WorkspaceShellLayout>(() => {
    const sidebarPlacement = sidebarPreferences.position;
    const effectivePlacement =
      sidebarPlacement === 'floating' ? floatingDockSide ?? 'left' : sidebarPlacement;
    const canReserveWorkspaceGutter =
      sidebarPlacement !== 'floating' ||
      (isWorkspaceFloatingDocked &&
        sidebarPreferences.floatingDockEnabled &&
        !workspaceDockAutoAttachSuppressed);
    const sidebarMode: SidebarAttachmentMode =
      shellFullscreen && isSidebarVisible && canReserveWorkspaceGutter ? 'attached' : 'overlay';
    const verticalSidebarWidth = state === 'expanded' ? 320 : 56;
    const horizontalSidebarHeight = state === 'expanded' ? 144 : 60;
    const isVerticalPlacement = effectivePlacement === 'left' || effectivePlacement === 'right';
    const attachedWidth = isVerticalPlacement ? verticalSidebarWidth : 0;
    const attachedHeight = isVerticalPlacement ? 0 : horizontalSidebarHeight;

    return {
      sidebarPlacement,
      sidebarMode,
      sidebarSize: {
        left:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'left'
            ? attachedWidth
            : 0,
        right:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'right'
            ? attachedWidth
            : 0,
        top:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'top'
            ? attachedHeight
            : 0,
        bottom:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'bottom'
            ? attachedHeight
            : 0,
      },
      shellFullscreen,
      workspaceShellStyle: {
        backgroundColor: shellFullscreen
          ? 'var(--ledger-surface-muted)'
          : 'var(--ledger-background)',
        paddingLeft:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'left'
            ? `${attachedWidth}px`
            : '0px',
        paddingRight:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'right'
            ? `${attachedWidth}px`
            : '0px',
        paddingTop:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'top'
            ? `${attachedHeight}px`
            : '0px',
        paddingBottom:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'bottom'
            ? `${attachedHeight}px`
            : '0px',
        ['--ledger-sidebar-inset-left' as string]:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'left'
            ? `${attachedWidth}px`
            : '0px',
        ['--ledger-sidebar-inset-right' as string]:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'right'
            ? `${attachedWidth}px`
            : '0px',
        ['--ledger-sidebar-inset-top' as string]:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'top'
            ? `${attachedHeight}px`
            : '0px',
        ['--ledger-sidebar-inset-bottom' as string]:
          shellFullscreen && sidebarMode === 'attached' && effectivePlacement === 'bottom'
            ? `${attachedHeight}px`
            : '0px',
      },
    };
  }, [
    floatingDockSide,
    isFloatingDocked,
    isWorkspaceFloatingDocked,
    workspaceDockAutoAttachSuppressed,
    isSidebarVisible,
    shellFullscreen,
    sidebarPreferences.position,
    sidebarPreferences.floatingDockEnabled,
    state,
  ]);

  return (
    <SidebarContext.Provider
      value={{
        state,
        setState,
        toggleExpand,
        isExpanded: sidebarPreferences.isExpanded,
        setIsExpanded,
        collapsedRestoreIsExpanded: sidebarPreferences.collapsedRestoreIsExpanded,
        isHidden: sidebarPreferences.isHidden,
        setIsHidden,
        toggleHidden,
        isVisible: !sidebarPreferences.isHidden,
        setIsVisible,
        toggleVisibility,
        position: sidebarPreferences.position,
        setPosition,
        opacity: sidebarPreferences.opacity,
        setOpacity,
        frostedBackgroundEnabled: sidebarPreferences.frostedBackgroundEnabled,
        setFrostedBackgroundEnabled,
        effectiveFrostedBackground,
        systemPrefersReducedTransparency,
        transparencyOverrideActive,
        materialEngine,
        materialRequestedEngine,
        materialFallbackReason,
        nativeMaterialActive,
        materialMacVibrancy,
        materialMacVisualEffectState,
        reduceMotion,
        defaultState: sidebarPreferences.defaultState,
        setDefaultState,
        alwaysOnTop: sidebarPreferences.alwaysOnTop,
        setAlwaysOnTop,
        autoHide: sidebarPreferences.autoHide,
        setAutoHide,
        setFloatingDockEnabled,
        setFloatingDockThreshold,
        collapseSidebar,
        collapseToRail,
        restoreSidebarView,
        floatingPosition: sidebarPreferences.floatingPosition,
        setFloatingPosition,
        isFloatingDocked,
        sidebarPreferences,
        moduleView,
        setModuleView,
        focusDate,
        setFocusDate,
        isHydrated,
        workspaceShellLayout,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within SidebarProvider');
  return context;
};
