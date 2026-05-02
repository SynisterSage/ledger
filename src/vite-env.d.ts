/// <reference types="vite/client" />

type SidebarWindowMode = 'auth' | 'minimized' | 'expanded' | 'fullscreen'
type ModuleWindowKind = 'calendar'

interface ImportMetaEnv {
  readonly VITE_ICAL_SERVICE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  desktopWindow?: {
    setMode: (mode: SidebarWindowMode) => Promise<void>
    toggleModule: (kind: ModuleWindowKind, focusDate?: string | null) => Promise<void>
    openExternal: (url: string) => Promise<void>
  }
}
