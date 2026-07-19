import { ipcRenderer, contextBridge } from 'electron';

const rendererListenerWrappers = new Map<string, Map<Function, Function>>();

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args;
    const wrapped = (event: Electron.IpcRendererEvent, ...payload: unknown[]) =>
      listener(event, ...payload);
    let channelListeners = rendererListenerWrappers.get(channel);
    if (!channelListeners) {
      channelListeners = new Map();
      rendererListenerWrappers.set(channel, channelListeners);
    }
    channelListeners.set(listener, wrapped);
    return ipcRenderer.on(channel, wrapped as Parameters<typeof ipcRenderer.on>[1]);
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, listener] = args;
    const wrapped = rendererListenerWrappers.get(channel)?.get(listener);
    const result = ipcRenderer.off(
      channel,
      (wrapped ?? listener) as Parameters<typeof ipcRenderer.off>[1]
    );
    rendererListenerWrappers.get(channel)?.delete(listener);
    return result;
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
  | 'new-tab'
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
  | 'quick-event'
  | 'quick-reminder';
type ModuleFocusPayload = {
  kind: ModuleWindowKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};
type LedgerTabSession = {
  tabId: string;
  workspaceId?: string | null;
  module: ModuleWindowKind;
  route: ModuleFocusPayload & { kind: ModuleWindowKind };
  selectedResourceId?: string | null;
  routeState?: Record<string, unknown>;
  tabHistory: Array<ModuleFocusPayload & { kind: ModuleWindowKind }>;
  historyIndex: number;
  title?: string;
  icon?: string;
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
  }) {
    return ipcRenderer.invoke('window:apply-sidebar-preferences', preferences);
  },
  dockFloatingWindow() {
    return ipcRenderer.invoke('window:dock-floating-window');
  },
  detachFloatingWindow() {
    return ipcRenderer.invoke('window:detach-floating-window');
  },
  getFloatingDockState() {
    return ipcRenderer.invoke('window:floating-dock-state') as Promise<{
      isDocked: boolean;
      attachmentStatus: string;
      side: 'right' | 'left' | 'top' | 'bottom' | 'floating' | null;
    }>;
  },
  openSearchInWorkspaceWindow(query = '') {
    return ipcRenderer.invoke('window:open-search-in-workspace-window', query) as Promise<boolean>;
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
  goBackWorkspaceWindow() {
    return ipcRenderer.invoke('window:workspace-go-back');
  },
  goForwardWorkspaceWindow() {
    return ipcRenderer.invoke('window:workspace-go-forward');
  },
  getWorkspaceNavigationState() {
    return ipcRenderer.invoke('window:workspace-navigation-state');
  },
  clearWorkspaceRecent() {
    return ipcRenderer.invoke('window:workspace-clear-recent');
  },
  getWindowBounds() {
    return ipcRenderer.invoke('window:get-bounds');
  },
  detachTab(session: LedgerTabSession, screenPoint: { x: number; y: number }) {
    return ipcRenderer.invoke('window:detach-tab', { session, screenPoint });
  },
  confirmTabDetach(transferId: string) {
    return ipcRenderer.invoke('window:confirm-tab-detach', transferId);
  },
  getTabDetachSession(transferId: string) {
    return ipcRenderer.invoke('window:get-tab-detach-session', transferId);
  },
  updateWorkspaceRoute(route: ModuleFocusPayload) {
    return ipcRenderer.invoke('window:workspace-route-changed', route);
  },
  selectWorkspaceRoute(route: ModuleFocusPayload) {
    return ipcRenderer.invoke('window:workspace-select-route', route);
  },
  closeWorkspaceRoute(route: ModuleFocusPayload) {
    return ipcRenderer.invoke('window:workspace-close-route', route);
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
