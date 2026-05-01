/// <reference types="vite/client" />

type SidebarWindowMode = 'auth' | 'minimized' | 'expanded' | 'fullscreen'
type ModuleWindowKind = 'calendar'

interface Window {
  desktopWindow?: {
    setMode: (mode: SidebarWindowMode) => Promise<void>
    toggleModule: (kind: ModuleWindowKind) => Promise<void>
  }
}
