/// <reference types="vite/client" />

  type SidebarWindowMode = 'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen'
type ModuleWindowKind = 'calendar' | 'notes' | 'projects' | 'dashboard' | 'settings'
type ModuleFocusPayload = {
  kind: ModuleWindowKind
  focusDate?: string | null
  focusProjectId?: string | null
  focusNoteId?: string | null
  focusTaskId?: string | null
}

interface ImportMetaEnv {
  readonly VITE_ICAL_SERVICE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __LEDGER_RUNTIME__?: {
    apiUrl?: string
    supabaseUrl?: string
    supabasePublishableKey?: string
  }
  desktopWindow?: {
    setMode: (mode: SidebarWindowMode) => Promise<void>
    setVisible: (isVisible: boolean) => Promise<void>
    setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>
    setFloatingPosition: (position: { x: number; y: number }) => Promise<void>
    beginFloatingDrag: () => Promise<void>
    applySidebarPreferences: (preferences: {
      position?: 'right' | 'left' | 'top' | 'bottom' | 'floating'
      opacity?: number
      blur?: boolean
      defaultState?: 'expanded' | 'collapsed' | 'remember'
      autoHide?: boolean
      isExpanded?: boolean
      collapsedRestoreIsExpanded?: boolean
      isHidden?: boolean
      floatingPosition?: { x: number; y: number }
      floatingDockEnabled?: boolean
      floatingDockThreshold?: number
      lastState?: 'expanded' | 'collapsed'
    }) => Promise<void>
    dockFloatingWindow: () => Promise<{ x: number; y: number; width: number; height: number } | null>
    detachFloatingWindow: () => Promise<void>
    toggleModule: (kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) => Promise<void>
    openExternal: (url: string) => Promise<void>
  }
}
