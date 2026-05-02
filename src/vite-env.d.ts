/// <reference types="vite/client" />

type SidebarWindowMode = 'auth' | 'minimized' | 'expanded' | 'fullscreen'
type ModuleWindowKind = 'calendar' | 'notes' | 'projects' | 'dashboard' | 'settings'
type ModuleFocusPayload = {
  kind: ModuleWindowKind
  focusDate?: string | null
  focusProjectId?: string | null
}

interface ImportMetaEnv {
  readonly VITE_ICAL_SERVICE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  desktopWindow?: {
    setMode: (mode: SidebarWindowMode) => Promise<void>
    toggleModule: (kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) => Promise<void>
    openExternal: (url: string) => Promise<void>
  }
}
