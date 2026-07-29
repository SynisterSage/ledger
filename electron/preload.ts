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

contextBridge.exposeInMainWorld('appleCalendar', {
  status() { return ipcRenderer.invoke('apple-calendar:status'); },
  requestAccess() { return ipcRenderer.invoke('apple-calendar:request-access'); },
  listCalendars() { return ipcRenderer.invoke('apple-calendar:list-calendars'); },
  events(payload: { start: string; end: string; calendarIds: string[] }) {
    return ipcRenderer.invoke('apple-calendar:events', payload);
  },
  refreshRange(payload: { start: string; end: string; calendarIds: string[] }) { return ipcRenderer.invoke('apple-calendar:refresh-range', payload); },
  getEvent(payload: { eventId: string }) { return ipcRenderer.invoke('apple-calendar:get-event', payload); },
  connectionStatus() { return ipcRenderer.invoke('apple-calendar:connection-status'); },
  writableCalendars() { return ipcRenderer.invoke('apple-calendar:writable-calendars'); },
  createEvent(payload: Record<string, unknown>) { return ipcRenderer.invoke('apple-calendar:create-event', payload); },
  updateEvent(payload: Record<string, unknown>) { return ipcRenderer.invoke('apple-calendar:update-event', payload); },
  deleteEvent(payload: { eventId: string; span?: 'thisEvent' | 'futureEvents' }) { return ipcRenderer.invoke('apple-calendar:delete-event', payload); },
  moveEvent(payload: { eventId: string; calendarId: string; span?: 'thisEvent' | 'futureEvents' }) { return ipcRenderer.invoke('apple-calendar:move-event', payload); },
  openSystemSettings() { return ipcRenderer.invoke('apple-calendar:open-system-settings'); },
  onChanged(listener: () => void) {
    const wrapped = () => listener();
    ipcRenderer.on('apple-calendar:changed', wrapped);
    return () => ipcRenderer.off('apple-calendar:changed', wrapped);
  },
});

contextBridge.exposeInMainWorld('appleReminders', {
  getPermissionStatus() { return ipcRenderer.invoke('apple-reminders:permission-status'); },
  getConnectionStatus() { return ipcRenderer.invoke('apple-reminders:connection-status'); },
  requestAccess() { return ipcRenderer.invoke('apple-reminders:request-access'); },
  getLists() { return ipcRenderer.invoke('apple-reminders:get-lists'); },
  getWritableLists() { return ipcRenderer.invoke('apple-reminders:get-writable-lists'); },
  getReminder(payload: { reminderId: string }) { return ipcRenderer.invoke('apple-reminders:get-reminder', payload); },
  createReminder(payload: Record<string, unknown>) { return ipcRenderer.invoke('apple-reminders:create-reminder', payload); },
  updateReminder(payload: Record<string, unknown>) { return ipcRenderer.invoke('apple-reminders:update-reminder', payload); },
  setCompleted(payload: { reminderId: string; completed: boolean; listId?: string }) { return ipcRenderer.invoke('apple-reminders:set-completed', payload); },
  moveReminder(payload: { reminderId: string; listId: string }) { return ipcRenderer.invoke('apple-reminders:move-reminder', payload); },
  deleteReminder(payload: { reminderId: string }) { return ipcRenderer.invoke('apple-reminders:delete-reminder', payload); },
  fetchReminders(payload: { start: string; end: string; listIds: string[] }) { return ipcRenderer.invoke('apple-reminders:fetch-reminders', payload); },
  refresh(payload: { start: string; end: string; listIds: string[] }) { return ipcRenderer.invoke('apple-reminders:refresh', payload); },
  disconnect() { return ipcRenderer.invoke('apple-reminders:disconnect'); },
  openSystemSettings() { return ipcRenderer.invoke('apple-reminders:open-system-settings'); },
});

contextBridge.exposeInMainWorld('meetingAudio', {
  permissions() { return ipcRenderer.invoke('meeting-audio:permissions'); },
  requestPermissions() { return ipcRenderer.invoke('meeting-audio:request-permissions'); },
  openSystemSettings(area: 'microphone' | 'screen-recording') {
    return ipcRenderer.invoke('meeting-audio:open-system-settings', area);
  },
  status() { return ipcRenderer.invoke('meeting-audio:status'); },
  devices() { return ipcRenderer.invoke('meeting-audio:devices'); },
  recoveries() { return ipcRenderer.invoke('meeting-audio:recoveries'); },
  inspect(sessionId?: string) { return ipcRenderer.invoke('meeting-audio:inspect', sessionId); },
  recover(payload: { sessionId: string; noteId: string; workspaceId: string }) {
    return ipcRenderer.invoke('meeting-audio:recover', payload);
  },
  discardRecovery(sessionId: string) { return ipcRenderer.invoke('meeting-audio:discard-recovery', sessionId); },
  start(payload: { noteId: string; workspaceId: string; microphone: boolean; systemAudio: boolean; microphoneDeviceId?: string | null }) {
    return ipcRenderer.invoke('meeting-audio:start', payload);
  },
  testSource(source: 'user_microphone' | 'system_audio', microphoneDeviceId?: string | null) {
    return ipcRenderer.invoke('meeting-audio:test-source', { source, microphoneDeviceId });
  },
  pause() { return ipcRenderer.invoke('meeting-audio:pause'); },
  resume() { return ipcRenderer.invoke('meeting-audio:resume'); },
  stop() { return ipcRenderer.invoke('meeting-audio:stop'); },
  reveal(payload: { sessionId: string }) {
    return ipcRenderer.invoke('meeting-audio:reveal', payload);
  },
  deleteAudio(payload: { sessionId: string; source?: 'user_microphone' | 'system_audio' }) {
    return ipcRenderer.invoke('meeting-audio:delete-audio', payload);
  },
  play(payload: { sessionId: string; source: 'user_microphone' | 'system_audio' }) {
    return ipcRenderer.invoke('meeting-audio:play', payload);
  },
  onLevel(listener: (event: { source: 'user_microphone' | 'system_audio'; level: number }) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { source: 'user_microphone' | 'system_audio'; level: number }) => listener(payload);
    ipcRenderer.on('meeting-audio:level', wrapped);
    return () => ipcRenderer.off('meeting-audio:level', wrapped);
  },
  onError(listener: (event: { source: 'user_microphone' | 'system_audio'; error: string }) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { source: 'user_microphone' | 'system_audio'; error: string }) => listener(payload);
    ipcRenderer.on('meeting-audio:error', wrapped);
    return () => ipcRenderer.off('meeting-audio:error', wrapped);
  },
});

contextBridge.exposeInMainWorld('meetingTranscription', {
  modelStatus() { return ipcRenderer.invoke('meeting-transcription:model-status'); },
  downloadModel() { return ipcRenderer.invoke('meeting-transcription:download-model'); },
  cancelModelDownload() { return ipcRenderer.invoke('meeting-transcription:cancel-model-download'); },
  deleteModel() { return ipcRenderer.invoke('meeting-transcription:delete-model'); },
  status(jobId?: string) { return ipcRenderer.invoke('meeting-transcription:status', jobId); },
  start(payload: { sessionId: string; noteId: string; workspaceId: string; force?: boolean }) { return ipcRenderer.invoke('meeting-transcription:start', payload); },
  cancel(jobId: string) { return ipcRenderer.invoke('meeting-transcription:cancel', jobId); },
  results(jobId: string) { return ipcRenderer.invoke('meeting-transcription:results', jobId); },
  complete(payload: { jobId: string; retention: 'delete_after_transcription' | 'retain' }) { return ipcRenderer.invoke('meeting-transcription:complete', payload); },
  fail(payload: { jobId: string; error: string }) { return ipcRenderer.invoke('meeting-transcription:fail', payload); },
  onProgress(listener: (event: unknown) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on('meeting-transcription:progress', wrapped);
    return () => ipcRenderer.off('meeting-transcription:progress', wrapped);
  },
  onModelChange(listener: (event: unknown) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on('meeting-transcription:model', wrapped);
    return () => ipcRenderer.off('meeting-transcription:model', wrapped);
  },
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
  | 'slack'
  | 'quick-follow-up'
  | 'quick-task'
  | 'quick-note'
  | 'quick-event'
  | 'quick-reminder';
type ModuleFocusPayload = {
  kind: ModuleWindowKind;
  historyMode?: 'push' | 'replace';
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusInboxId?: string | null;
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
