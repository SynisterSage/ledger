import { ipcRenderer, contextBridge } from 'electron';

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args;
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args;
    return ipcRenderer.off(channel, ...omit);
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },

  // You can expose other APTs you need here.
  // ...
});

type SidebarWindowMode = 'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen';
type ModuleWindowKind =
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
  kind: ModuleWindowKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
};

contextBridge.exposeInMainWorld('desktopWindow', {
  setMode(mode: SidebarWindowMode) {
    return ipcRenderer.invoke('window:set-mode', mode);
  },
  setVisible(isVisible: boolean) {
    return ipcRenderer.invoke('window:set-visible', isVisible);
  },
  hideTemporary() {
    return ipcRenderer.invoke('window:hide-temporary');
  },
  quitApp() {
    return ipcRenderer.invoke('window:quit-app');
  },
  setAlwaysOnTop(alwaysOnTop: boolean) {
    return ipcRenderer.invoke('window:set-always-on-top', alwaysOnTop);
  },
  setFloatingPosition(position: { x: number; y: number }) {
    return ipcRenderer.invoke('window:set-floating-position', position);
  },
  beginFloatingDrag() {
    return ipcRenderer.invoke('window:begin-floating-drag') as Promise<{ x: number; y: number }>;
  },
  finishFloatingDrag() {
    return ipcRenderer.invoke('window:finish-floating-drag') as Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
  },
  updateFloatingDrag() {
    return ipcRenderer.invoke('window:update-floating-drag') as Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
  },
  beginHeaderDrag() {
    return ipcRenderer.invoke('window:begin-header-drag') as Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
  },
  updateHeaderDrag() {
    return ipcRenderer.invoke('window:update-header-drag') as Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
  },
  finishHeaderDrag() {
    return ipcRenderer.invoke('window:finish-header-drag') as Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
  },
  applySidebarPreferences(preferences: {
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
  }) {
    return ipcRenderer.invoke('window:apply-sidebar-preferences', preferences);
  },
  dockFloatingWindow() {
    return ipcRenderer.invoke('window:dock-floating-window');
  },
  detachFloatingWindow() {
    return ipcRenderer.invoke('window:detach-floating-window');
  },
  toggleModule(kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) {
    const payload =
      typeof focus === 'string' ? { kind, focusDate: focus } : { kind, ...(focus ?? {}) };
    return ipcRenderer.invoke('window:toggle-module', payload);
  },
  openModule(kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) {
    const payload =
      typeof focus === 'string' ? { kind, focusDate: focus } : { kind, ...(focus ?? {}) };
    return ipcRenderer.invoke('window:open-module', payload);
  },
  closeModule(kind: ModuleWindowKind) {
    return ipcRenderer.invoke('window:close-module', kind);
  },
  minimizeModule(kind: ModuleWindowKind) {
    return ipcRenderer.invoke('window:minimize-module', kind);
  },
  toggleModuleFullscreen(kind: ModuleWindowKind) {
    return ipcRenderer.invoke('window:toggle-module-fullscreen', kind);
  },
  setHasShadow(enabled: boolean) {
    return ipcRenderer.invoke('window:set-has-shadow', enabled);
  },
  openExternal(url: string) {
    return ipcRenderer.invoke('window:open-external', url);
  },
  openCheckin() {
    return ipcRenderer.invoke('window:open-checkin');
  },
});
