/// <reference types="vite/client" />

type SidebarWindowMode = 'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen';
type ModuleWindowKind = 'calendar' | 'notes' | 'projects' | 'dashboard' | 'settings';
type ModuleFocusPayload = {
  kind?: ModuleWindowKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
};

interface ImportMetaEnv {
  readonly VITE_ICAL_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __LEDGER_RUNTIME__?: {
    apiUrl?: string;
    supabaseUrl?: string;
    supabasePublishableKey?: string;
  };
  desktopWindow?: {
    setMode: (mode: SidebarWindowMode) => Promise<void>;
    setVisible: (isVisible: boolean) => Promise<void>;
    hideTemporary: () => Promise<void>;
    quitApp: () => Promise<void>;
    setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>;
    setFloatingPosition: (position: { x: number; y: number }) => Promise<void>;
    beginFloatingDrag: () => Promise<{ x: number; y: number }>;
    applySidebarPreferences: (preferences: {
      position?: 'right' | 'left' | 'top' | 'bottom' | 'floating';
      opacity?: number;
      blur?: boolean;
      defaultState?: 'expanded' | 'collapsed' | 'remember';
      autoHide?: boolean;
      isExpanded?: boolean;
      collapsedRestoreIsExpanded?: boolean;
      isHidden?: boolean;
      floatingPosition?: { x: number; y: number };
      floatingDockEnabled?: boolean;
      floatingDockThreshold?: number;
      lastState?: 'expanded' | 'collapsed';
    }) => Promise<void>;
    dockFloatingWindow: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    detachFloatingWindow: () => Promise<void>;
    toggleModule: (kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) => Promise<void>;
    closeModule: (kind: ModuleWindowKind) => Promise<void>;
    minimizeModule: (kind: ModuleWindowKind) => Promise<void>;
    toggleModuleFullscreen: (kind: ModuleWindowKind) => Promise<boolean>;
    openExternal: (url: string) => Promise<void>;
    openCheckin: () => Promise<void>;
  };
}
