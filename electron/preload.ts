import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

type SidebarWindowMode = 'auth' | 'minimized' | 'expanded' | 'fullscreen'
type ModuleWindowKind = 'calendar' | 'notes' | 'projects'
type ModuleFocusPayload = {
  kind: ModuleWindowKind
  focusDate?: string | null
  focusProjectId?: string | null
}

contextBridge.exposeInMainWorld('desktopWindow', {
  setMode(mode: SidebarWindowMode) {
    return ipcRenderer.invoke('window:set-mode', mode)
  },
  toggleModule(kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) {
    const payload = typeof focus === 'string'
      ? { kind, focusDate: focus }
      : { kind, ...(focus ?? {}) }
    return ipcRenderer.invoke('window:toggle-module', payload)
  },
  openExternal(url: string) {
    return ipcRenderer.invoke('window:open-external', url)
  },
})
