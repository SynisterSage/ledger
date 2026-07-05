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
  loadSidebarPreferences,
  saveSidebarPreferences,
  type SidebarFloatingPosition,
  type SidebarDefaultState,
  type SidebarPosition,
  type SidebarPreferences,
} from '../config/sidebarPreferences';

export type SidebarState = 'minimized' | 'expanded' | 'fullscreen';
export type ModuleView = 'dashboard' | 'calendar';
export type SidebarAttachmentMode = 'attached' | 'overlay';
type WorkspaceShellKind = 'dashboard' | 'calendar' | 'notes' | 'projects' | 'teams' | 'settings';
type FloatingDockPayload = {
  isDocked?: boolean;
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
  'dashboard',
  'calendar',
  'notes',
  'projects',
  'teams',
  'settings',
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
  blur: boolean;
  setBlur: (blur: boolean) => void;
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
  const didNormalizeFloatingStartupRef = React.useRef(false);
  const wasFloatingDockedRef = React.useRef(false);
  const [isFloatingDocked, setIsFloatingDocked] = React.useState(false);
  const [shellFullscreen, setShellFullscreen] = useState(false);
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

    window.ipcRenderer?.on('sidebar:preferences-updated', handlePreferenceSync);
    return () => {
      window.ipcRenderer?.off('sidebar:preferences-updated', handlePreferenceSync);
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
      const nextSide =
        payload && typeof (payload as { side?: unknown }).side === 'string'
          ? ((payload as { side?: unknown }).side as SidebarPosition)
          : null;
      const wasDocked = wasFloatingDockedRef.current;

      wasFloatingDockedRef.current = nextIsDocked;
      setIsFloatingDocked(nextIsDocked);
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

    window.ipcRenderer?.on('sidebar:floating-dock-changed', handleFloatingDockChanged);
    return () => {
      window.ipcRenderer?.off('sidebar:floating-dock-changed', handleFloatingDockChanged);
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

    window.ipcRenderer?.on('module:fullscreen-state-changed', handleModuleFullscreenState);
    return () => {
      window.ipcRenderer?.off('module:fullscreen-state-changed', handleModuleFullscreenState);
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

    window.ipcRenderer?.on('sidebar:state-changed', handleSidebarStateChanged);
    return () => {
      window.ipcRenderer?.off('sidebar:state-changed', handleSidebarStateChanged);
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

    window.ipcRenderer?.on('module:state-changed', handleModuleStateChanged);
    return () => {
      window.ipcRenderer?.off('module:state-changed', handleModuleStateChanged);
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
    const clampedOpacity = Math.max(0.7, Math.min(1, opacity));
    setSidebarPreferences((current) => ({
      ...current,
      opacity: clampedOpacity,
    }));
  };

  const setBlur = (blur: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      blur,
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
  const workspaceShellLayout = useMemo<WorkspaceShellLayout>(() => {
    const sidebarPlacement = sidebarPreferences.position;
    const effectivePlacement =
      sidebarPlacement === 'floating' ? floatingDockSide ?? 'left' : sidebarPlacement;
    const sidebarMode: SidebarAttachmentMode =
      shellFullscreen && isSidebarVisible ? 'attached' : 'overlay';
    const verticalSidebarWidth = state === 'expanded' ? 320 : 64;
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
    isSidebarVisible,
    shellFullscreen,
    sidebarPreferences.position,
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
        blur: sidebarPreferences.blur,
        setBlur,
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
