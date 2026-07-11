/// <reference types="vite/client" />

type SidebarWindowMode = 'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen';
type ModuleWindowKind =
  | 'circle'
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'teams'
  | 'dashboard'
  | 'notifications'
  | 'settings'
  | 'inbox'
  | 'quick-follow-up'
  | 'quick-task'
  | 'quick-note'
  | 'quick-event';
type ModuleFocusPayload = {
  kind?: ModuleWindowKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
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
    ledgerWebUrl?: string;
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
    finishFloatingDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    updateFloatingDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    beginHeaderDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    updateHeaderDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    finishHeaderDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    applySidebarPreferences: (preferences: {
      position?: 'right' | 'left' | 'top' | 'bottom' | 'floating';
      opacity?: number;
      blur?: boolean;
      defaultState?: 'expanded' | 'collapsed' | 'remember';
      alwaysOnTop?: boolean;
      shellFullscreen?: boolean;
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
    getFloatingDockState: () => Promise<{
      isDocked: boolean;
      attachmentStatus: string;
      side: 'right' | 'left' | 'top' | 'bottom' | 'floating' | null;
    }>;
    toggleModule: (kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) => Promise<void>;
    openModule: (kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) => Promise<void>;
    closeModule: (kind: ModuleWindowKind) => Promise<void>;
    minimizeModule: (kind: ModuleWindowKind) => Promise<void>;
    toggleModuleFullscreen: (kind: ModuleWindowKind) => Promise<boolean>;
    goBackWorkspaceWindow?: () => Promise<void>;
    goForwardWorkspaceWindow?: () => Promise<void>;
    getWorkspaceNavigationState?: () => Promise<{
      canGoBack: boolean;
      canGoForward: boolean;
      currentModule: ModuleWindowKind | null;
    }>;
    updateWorkspaceRoute?: (route: ModuleFocusPayload) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    openCheckin: () => Promise<void>;
  };
}
