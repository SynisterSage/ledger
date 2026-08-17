import { ipcRenderer, contextBridge } from 'electron';
import { encodePcmWav, TARGET_SAMPLE_RATE } from './audio-capture/wav';

const rendererListenerWrappers = new Map<string, Map<string, Function>>();
let nextRendererListenerId = 0;

type WindowsCaptureSource = 'user_microphone' | 'system_audio';
type WindowsCaptureRuntime = {
  sessionId: string;
  startedAt: number;
  paused: boolean;
  pauseStartedAt: number | null;
  pausedMilliseconds: number;
  sources: Map<WindowsCaptureSource, WindowsCaptureSourceRuntime>;
  microphoneStream: MediaStream | null;
  displayStream: MediaStream | null;
  deviceChange: (() => void) | null;
  streamListeners: Array<{ stream: MediaStream; listener: () => void }>;
};
type WindowsCaptureSourceRuntime = {
  source: WindowsCaptureSource;
  stream: MediaStream;
  context: AudioContext;
  processor: ScriptProcessorNode;
  gain: GainNode;
  buffers: Float32Array[][];
  frameCount: number;
  sequence: number;
  chunkStartedAt: number;
  flushing: Promise<void>;
  trackListeners: Array<{ track: MediaStreamTrack; listener: () => void }>;
};
const windowsCaptureRuntimes = new Map<string, WindowsCaptureRuntime>();
const windowsDeviceChangeListener = () => ipcRenderer.send('meeting-audio:windows-event', { event: 'devices-changed' });
navigator.mediaDevices?.addEventListener('devicechange', windowsDeviceChangeListener);
window.addEventListener('beforeunload', () => navigator.mediaDevices?.removeEventListener('devicechange', windowsDeviceChangeListener));

function windowsCaptureError(code: string, message: string, source?: WindowsCaptureSource) {
  return { event: 'error', sessionId: windowsCaptureRuntimes.keys().next().value ?? '', source, code, error: message };
}

async function flushWindowsSource(runtime: WindowsCaptureRuntime, source: WindowsCaptureSourceRuntime) {
  if (!source.frameCount) return;
  const buffers = source.buffers;
  const frameCount = source.frameCount;
  source.buffers = Array.from({ length: buffers.length }, () => []);
  source.frameCount = 0;
  const startAt = new Date(source.chunkStartedAt).toISOString();
  source.chunkStartedAt = Date.now();
  const wav = encodePcmWav(buffers, frameCount, source.context.sampleRate);
  const endAt = new Date().toISOString();
  const data = wav;
  source.flushing = source.flushing.then(async () => {
    await ipcRenderer.invoke('meeting-audio:windows-chunk', { sessionId: runtime.sessionId, source: source.source, sequence: source.sequence++, startAt, endAt, durationSeconds: frameCount / source.context.sampleRate, data });
  }).catch((error) => {
    ipcRenderer.send('meeting-audio:windows-event', windowsCaptureError('capture_interrupted', error instanceof Error ? error.message : 'Windows audio chunk could not be saved.', source.source));
  });
  await source.flushing;
}

async function stopWindowsRuntime(runtime: WindowsCaptureRuntime) {
  const pending = [...runtime.sources.values()].map((source) => flushWindowsSource(runtime, source));
  await Promise.allSettled(pending);
  runtime.sources.forEach((source) => {
    source.trackListeners.forEach(({ track, listener }) => track.removeEventListener('ended', listener));
    source.processor.onaudioprocess = null;
    source.processor.disconnect();
    source.gain.disconnect();
    void source.context.close();
  });
  [runtime.microphoneStream, runtime.displayStream].forEach((stream) => stream?.getTracks().forEach((track) => track.stop()));
  if (runtime.deviceChange) navigator.mediaDevices.removeEventListener('devicechange', runtime.deviceChange);
  runtime.streamListeners.forEach(({ stream, listener }) => stream.removeEventListener('inactive', listener));
  windowsCaptureRuntimes.delete(runtime.sessionId);
}

async function startWindowsRuntime(command: { sessionId: string; microphone: boolean; systemAudio: boolean; microphoneDeviceId?: string | null; requestId: string }) {
  if (windowsCaptureRuntimes.has(command.sessionId)) {
    ipcRenderer.send('meeting-audio:windows-event', { event: 'error', requestId: command.requestId, sessionId: command.sessionId, code: 'already_recording', error: 'Another Windows audio capture session is already active.' });
    return;
  }
  const runtime: WindowsCaptureRuntime = { sessionId: command.sessionId, startedAt: Date.now(), paused: false, pauseStartedAt: null, pausedMilliseconds: 0, sources: new Map(), microphoneStream: null, displayStream: null, deviceChange: null, streamListeners: [] };
  windowsCaptureRuntimes.set(command.sessionId, runtime);
  try {
    if (command.microphone) {
      try {
        runtime.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: command.microphoneDeviceId ? { deviceId: { exact: command.microphoneDeviceId } } : true, video: false });
      } catch (error) {
        throw { code: /denied|permission/i.test(String(error)) ? 'microphone_permission_denied' : 'no_microphone_available', message: 'Ledger could not access the selected Windows microphone.' };
      }
      if (!runtime.microphoneStream.getAudioTracks().some((track) => track.readyState === 'live')) throw { code: 'no_microphone_available', message: 'No live Windows microphone track is available.' };
    }
    if (command.systemAudio) {
      try { runtime.displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
      catch { throw { code: 'display_capture_denied', message: 'Windows display capture permission was denied.' }; }
      if (!runtime.displayStream.getAudioTracks().some((track) => track.readyState === 'live')) throw { code: 'no_output_device_available', message: 'Windows returned no live system-audio track from the active output device.' };
    }
    const streams: Array<[WindowsCaptureSource, MediaStream | null]> = [['user_microphone', runtime.microphoneStream], ['system_audio', runtime.displayStream ? new MediaStream(runtime.displayStream.getAudioTracks()) : null]];
    for (const [sourceName, stream] of streams) {
      if (!stream) continue;
      const context = new AudioContext();
      const mediaSource = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount || 1), Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount || 1));
      const gain = context.createGain();
      gain.gain.value = 0;
      const source: WindowsCaptureSourceRuntime = { source: sourceName, stream, context, processor, gain, buffers: Array.from({ length: processor.channelCount }, () => []), frameCount: 0, sequence: 0, chunkStartedAt: Date.now(), flushing: Promise.resolve(), trackListeners: [] };
      processor.onaudioprocess = (event) => {
        if (runtime.paused) return;
        const input = event.inputBuffer;
        source.frameCount += input.length;
        for (let channel = 0; channel < source.buffers.length; channel += 1) source.buffers[channel].push(new Float32Array(input.getChannelData(Math.min(channel, input.numberOfChannels - 1))));
        let energy = 0;
        const samples = input.getChannelData(0);
        for (let index = 0; index < samples.length; index += 1) energy += samples[index] * samples[index];
        ipcRenderer.send('meeting-audio:windows-event', { event: 'level', sessionId: runtime.sessionId, source: sourceName, level: Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)) * 4) });
        if (source.frameCount >= context.sampleRate * 30) void flushWindowsSource(runtime, source);
      };
      const onEnded = () => ipcRenderer.send('meeting-audio:windows-event', windowsCaptureError('device_disconnected', `${sourceName === 'system_audio' ? 'System audio' : 'Microphone'} capture ended.`, sourceName));
      stream.getTracks().forEach((track) => { track.addEventListener('ended', onEnded); source.trackListeners.push({ track, listener: onEnded }); });
      if (sourceName === 'system_audio') runtime.displayStream?.getVideoTracks().forEach((track) => { track.addEventListener('ended', onEnded); source.trackListeners.push({ track, listener: onEnded }); });
      stream.addEventListener('inactive', onEnded); runtime.streamListeners.push({ stream, listener: onEnded });
      if (sourceName === 'system_audio' && runtime.displayStream) { runtime.displayStream.addEventListener('inactive', onEnded); runtime.streamListeners.push({ stream: runtime.displayStream, listener: onEnded }); }
      mediaSource.connect(processor); processor.connect(gain); gain.connect(context.destination);
      source.context.resume();
      runtime.sources.set(sourceName, source);
    }
    runtime.deviceChange = () => {
      ipcRenderer.send('meeting-audio:windows-event', { event: 'devices-changed' });
      runtime.sources.forEach((source) => { if (!source.stream.getAudioTracks().some((track) => track.readyState === 'live')) ipcRenderer.send('meeting-audio:windows-event', windowsCaptureError('device_disconnected', `${source.source === 'system_audio' ? 'System audio' : 'Microphone'} device disconnected.`, source.source)); });
    };
    navigator.mediaDevices.addEventListener('devicechange', runtime.deviceChange);
    const sources = [...runtime.sources.values()].map((source) => ({ source: source.source, sampleRate: TARGET_SAMPLE_RATE, channels: 1, active: true }));
    if (!sources.length) throw { code: 'empty_audio_stream', message: 'Windows did not provide a usable audio stream.' };
    ipcRenderer.send('meeting-audio:windows-event', { event: 'started', requestId: command.requestId, sessionId: command.sessionId, sources, warnings: [] });
  } catch (error) {
    await stopWindowsRuntime(runtime);
    const detail = error && typeof error === 'object' ? error as { code?: string; message?: string } : {};
    ipcRenderer.send('meeting-audio:windows-event', { event: 'error', requestId: command.requestId, sessionId: command.sessionId, code: detail.code || 'capture_initialization_failed', error: detail.message || 'Windows audio capture could not start.' });
  }
}

async function handleWindowsCaptureCommand(command: { command: string; requestId: string; sessionId: string; microphone?: boolean; systemAudio?: boolean; microphoneDeviceId?: string | null }) {
  if (command.command === 'start') return startWindowsRuntime({ ...command, microphone: command.microphone !== false, systemAudio: command.systemAudio !== false });
  if (command.command === 'devices') {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput').map((device) => ({ id: device.deviceId, name: device.label || 'Microphone', kind: 'input' as const, available: true, isBluetooth: /bluetooth|headset|airpods/i.test(device.label), isDefault: device.deviceId === 'default', isOutputDefault: false, channelCount: 1 }));
    const output = devices.find((device) => device.kind === 'audiooutput' && device.deviceId === 'default');
    ipcRenderer.send('meeting-audio:windows-event', { event: 'started', requestId: command.requestId, sessionId: command.sessionId, devices: inputs, outputDevice: output ? { id: output.deviceId, name: output.label || 'Current output', isBluetooth: /bluetooth|headset|airpods/i.test(output.label) } : null, sources: [], warnings: [] });
    return;
  }
  if (command.command === 'permissions' || command.command === 'request-permissions') {
    let microphone: 'granted' | 'denied' | 'not_requested' = 'granted';
    let systemAudio: 'granted' | 'denied' | 'not_requested' = 'granted';
    try { const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName }); microphone = status?.state === 'denied' ? 'denied' : status?.state === 'prompt' ? 'not_requested' : 'granted'; } catch {}
    if (command.command === 'request-permissions') {
      try { const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); mic.getTracks().forEach((track) => track.stop()); microphone = 'granted'; } catch { microphone = 'denied'; }
      try { const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); display.getTracks().forEach((track) => track.stop()); systemAudio = 'granted'; } catch { systemAudio = 'denied'; }
    }
    ipcRenderer.send('meeting-audio:windows-event', { event: 'started', requestId: command.requestId, sessionId: command.sessionId, microphone, systemAudio, sources: [], warnings: [] });
    return;
  }
  const runtime = windowsCaptureRuntimes.get(command.sessionId);
  if (!runtime) { ipcRenderer.send('meeting-audio:windows-event', { event: 'error', requestId: command.requestId, sessionId: command.sessionId, code: 'invalid_state', error: 'Windows audio capture is not active.' }); return; }
  if (command.command === 'pause') { await Promise.all([...runtime.sources.values()].map((source) => flushWindowsSource(runtime, source))); runtime.paused = true; runtime.pauseStartedAt = Date.now(); ipcRenderer.send('meeting-audio:windows-event', { event: 'paused', requestId: command.requestId, sessionId: command.sessionId }); return; }
  if (command.command === 'resume') { if (runtime.pauseStartedAt) runtime.pausedMilliseconds += Date.now() - runtime.pauseStartedAt; runtime.pauseStartedAt = null; runtime.paused = false; ipcRenderer.send('meeting-audio:windows-event', { event: 'resumed', requestId: command.requestId, sessionId: command.sessionId }); return; }
  if (command.command === 'flush') { await Promise.all([...runtime.sources.values()].map((source) => flushWindowsSource(runtime, source))); ipcRenderer.send('meeting-audio:windows-event', { event: 'flushed', requestId: command.requestId, sessionId: command.sessionId }); return; }
  if (command.command === 'health') {
    const sources = [...runtime.sources.values()].map((source) => ({ source: source.source, sampleRate: TARGET_SAMPLE_RATE, channels: 1, active: source.stream.getAudioTracks().some((track) => track.readyState === 'live') }));
    ipcRenderer.send('meeting-audio:windows-event', { event: 'health', requestId: command.requestId, sessionId: command.sessionId, sources });
    return;
  }
  if (command.command === 'stop') { await stopWindowsRuntime(runtime); ipcRenderer.send('meeting-audio:windows-event', { event: 'stopped', requestId: command.requestId, sessionId: command.sessionId, durationSeconds: Math.max(0, (Date.now() - runtime.startedAt - runtime.pausedMilliseconds) / 1000) }); }
}

ipcRenderer.on('meeting-audio:windows-command', (_event, command: Parameters<typeof handleWindowsCaptureCommand>[0]) => { void handleWindowsCaptureCommand(command); });

// --------- Expose a fixed, least-privilege API to the Renderer process ---------
// Keep channel names in this preload-only allowlist. The renderer receives
// named methods, never an arbitrary ipcRenderer channel dispatcher.
const subscribeToLedgerEvent = (channel: string, listener: Function) => {
  const wrapped = (event: Electron.IpcRendererEvent, ...payload: unknown[]) => listener(event, ...payload);
  let channelListeners = rendererListenerWrappers.get(channel);
  if (!channelListeners) {
    channelListeners = new Map();
    rendererListenerWrappers.set(channel, channelListeners);
  }
  const subscriptionId = `${channel}:${++nextRendererListenerId}`;
  channelListeners.set(subscriptionId, wrapped);
  ipcRenderer.on(channel, wrapped as Parameters<typeof ipcRenderer.on>[1]);
  return subscriptionId;
};

const unsubscribeFromLedgerEvent = (channel: string, subscriptionId: unknown) => {
  const channelListeners = rendererListenerWrappers.get(channel);
  if (!channelListeners?.size) return;
  // New callers pass the opaque token returned by `on...`. Keep a bounded
  // compatibility path for older renderer code that still passes its
  // callback through contextBridge (where callback identity is proxied).
  const token = typeof subscriptionId === 'string'
    ? subscriptionId
    : [...channelListeners.keys()].at(-1);
  const wrapped = token ? channelListeners.get(token) : undefined;
  if (!wrapped) return;
  ipcRenderer.off(channel, wrapped as Parameters<typeof ipcRenderer.off>[1]);
  if (token) channelListeners.delete(token);
  if (channelListeners.size === 0) rendererListenerWrappers.delete(channel);
};

const ledgerEventChannels = {
  onCalendarFollowUpCreated: 'calendar:follow-up-created', offCalendarFollowUpCreated: 'calendar:follow-up-created',
  onCalendarItemsUpdated: 'calendar:items-updated', offCalendarItemsUpdated: 'calendar:items-updated',
  onDailyCheckinUpdated: 'daily:checkin-updated', offDailyCheckinUpdated: 'daily:checkin-updated',
  onDashboardTodayTaskCreated: 'dashboard:today-task-created', offDashboardTodayTaskCreated: 'dashboard:today-task-created',
  onDashboardTodayTaskDeleted: 'dashboard:today-task-deleted', offDashboardTodayTaskDeleted: 'dashboard:today-task-deleted',
  onInboxItemsUpdated: 'inbox:items-updated', offInboxItemsUpdated: 'inbox:items-updated',
  onLedgerNotificationsBatch: 'ledger:notifications-batch', offLedgerNotificationsBatch: 'ledger:notifications-batch',
  onLedgerNotificationsSummary: 'ledger:notifications-summary', offLedgerNotificationsSummary: 'ledger:notifications-summary',
  onLedgerOpenInvite: 'ledger:open-invite', offLedgerOpenInvite: 'ledger:open-invite',
  onLedgerSetActiveWorkspace: 'ledger:set-active-workspace', offLedgerSetActiveWorkspace: 'ledger:set-active-workspace',
  onLedgerThemeUpdated: 'ledger:theme-updated', offLedgerThemeUpdated: 'ledger:theme-updated',
  onModuleFocusContext: 'module:focus-context', offModuleFocusContext: 'module:focus-context',
  onModuleFocusInbox: 'module:focus-inbox', offModuleFocusInbox: 'module:focus-inbox',
  onModuleFocusNote: 'module:focus-note', offModuleFocusNote: 'module:focus-note',
  onModuleFocusProject: 'module:focus-project', offModuleFocusProject: 'module:focus-project',
  onModuleFocusSection: 'module:focus-section', offModuleFocusSection: 'module:focus-section',
  onModuleFocusTask: 'module:focus-task', offModuleFocusTask: 'module:focus-task',
  onModuleFullscreenStateChanged: 'module:fullscreen-state-changed', offModuleFullscreenStateChanged: 'module:fullscreen-state-changed',
  onModuleStateChanged: 'module:state-changed', offModuleStateChanged: 'module:state-changed',
  onNotesSmartLinksUpdated: 'notes:smart-links-updated', offNotesSmartLinksUpdated: 'notes:smart-links-updated',
  onSearchOpen: 'search:open', offSearchOpen: 'search:open',
  onSettingsFocusSection: 'settings:focus-section', offSettingsFocusSection: 'settings:focus-section',
  onSettingsGithubCallback: 'settings:github-callback', offSettingsGithubCallback: 'settings:github-callback',
  onSidebarAccessibilityUpdated: 'sidebar:accessibility-updated', offSidebarAccessibilityUpdated: 'sidebar:accessibility-updated',
  onSidebarFloatingDockChanged: 'sidebar:floating-dock-changed', offSidebarFloatingDockChanged: 'sidebar:floating-dock-changed',
  onSidebarMaterialState: 'sidebar:material-state', offSidebarMaterialState: 'sidebar:material-state',
  onSidebarOpacityPreview: 'sidebar:opacity-preview', offSidebarOpacityPreview: 'sidebar:opacity-preview',
  onSidebarOpenCheckin: 'sidebar:open-checkin', offSidebarOpenCheckin: 'sidebar:open-checkin',
  onSidebarPreferencesUpdated: 'sidebar:preferences-updated', offSidebarPreferencesUpdated: 'sidebar:preferences-updated',
  onSidebarStateChanged: 'sidebar:state-changed', offSidebarStateChanged: 'sidebar:state-changed',
  onSidebarVisibilityChanged: 'sidebar:visibility-changed', offSidebarVisibilityChanged: 'sidebar:visibility-changed',
  onSlackConnectionChanged: 'slack:connection-changed', offSlackConnectionChanged: 'slack:connection-changed',
  onSlackIdentityChanged: 'slack:identity-changed', offSlackIdentityChanged: 'slack:identity-changed',
  onSpellcheckContextMenu: 'spellcheck:context-menu', offSpellcheckContextMenu: 'spellcheck:context-menu',
  onTabHydrateSession: 'tab:hydrate-session', offTabHydrateSession: 'tab:hydrate-session',
  onTouchbarOpenSearch: 'touchbar:open-search', offTouchbarOpenSearch: 'touchbar:open-search',
  onWorkspaceNavigationState: 'workspace:navigation-state', offWorkspaceNavigationState: 'workspace:navigation-state',
  onWorkspaceRouteChanged: 'workspace:route-changed', offWorkspaceRouteChanged: 'workspace:route-changed',
  onWorkspaceRouteRequested: 'workspace:route-requested', offWorkspaceRouteRequested: 'workspace:route-requested',
  onWorkspaceCloseActiveTab: 'workspace:close-active-tab', offWorkspaceCloseActiveTab: 'workspace:close-active-tab',
} as const;

const ledgerEvents = Object.fromEntries(Object.entries(ledgerEventChannels).map(([name, channel]) => [
  name,
  (listener: Function) => name.startsWith('on')
    ? subscribeToLedgerEvent(channel, listener)
    : unsubscribeFromLedgerEvent(channel, listener),
])) as Record<string, (listener: Function) => string | void>;

const ledgerCommands = {
  calendarFollowUpCreated: (payload?: unknown) => ipcRenderer.send('calendar:follow-up-created', payload),
  calendarItemsUpdated: () => ipcRenderer.send('calendar:items-updated'),
  dailyCheckinUpdated: (payload?: unknown) => ipcRenderer.send('daily:checkin-updated', payload),
  dashboardTodayTaskCreated: (payload?: unknown) => ipcRenderer.send('dashboard:today-task-created', payload),
  dashboardTodayTaskDeleted: (payload?: unknown) => ipcRenderer.send('dashboard:today-task-deleted', payload),
  inboxItemsUpdated: (payload?: unknown) => ipcRenderer.send('inbox:items-updated', payload),
  ledgerThemeUpdated: (payload?: unknown) => ipcRenderer.send('ledger:theme-updated', payload),
  notesSmartLinksUpdated: (payload?: unknown) => ipcRenderer.send('notes:smart-links-updated', payload),
  notificationsRefresh: () => ipcRenderer.send('notifications:refresh'),
  notificationsSetSession: (payload?: unknown) => ipcRenderer.send('notifications:set-session', payload),
  slackConnectionChanged: () => ipcRenderer.send('slack:connection-changed'),
  spellcheckAddWord: (word: string) => ipcRenderer.send('spellcheck:add-word', word),
  spellcheckReplace: (suggestion: string) => ipcRenderer.send('spellcheck:replace', suggestion),
  trayUpdateState: (payload?: unknown) => ipcRenderer.send('tray:update-state', payload),
  spellcheckAutocorrectNote: (payload: unknown) => ipcRenderer.invoke('spellcheck:autocorrect-note', payload),
  spellcheckSuggestions: (payload: unknown) => ipcRenderer.invoke('spellcheck:suggestions', payload),
};

contextBridge.exposeInMainWorld('ledgerIpc', { events: ledgerEvents, commands: ledgerCommands });

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
  storagePath() { return ipcRenderer.invoke('meeting-audio:storage-path'); },
  openStoragePath() { return ipcRenderer.invoke('meeting-audio:open-storage-path'); },
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
  onDevicesChanged(listener: () => void) {
    const wrapped = () => listener();
    ipcRenderer.on('meeting-audio:devices-changed', wrapped);
    return () => ipcRenderer.off('meeting-audio:devices-changed', wrapped);
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

contextBridge.exposeInMainWorld('askLedger', {
  localAIStatus() { return ipcRenderer.invoke('ask-ledger:local-ai-status'); },
  localAIHardware() { return ipcRenderer.invoke('ask-ledger:local-ai-hardware'); },
  downloadLocalAI(role: 'generation' | 'embedding') { return ipcRenderer.invoke('ask-ledger:local-ai-download', role); },
  cancelLocalAIDownload(role: 'generation' | 'embedding') { return ipcRenderer.invoke('ask-ledger:local-ai-cancel-download', role); },
  removeLocalAI(role: 'generation' | 'embedding') { return ipcRenderer.invoke('ask-ledger:local-ai-remove', role); },
  start(payload: { question: string; workspaceId: string; documents: unknown[]; lexicalResults: unknown[]; conversation?: unknown }) {
    return ipcRenderer.invoke('ask-ledger:start', payload) as Promise<{ requestId: string }>;
  },
  cancel(requestId: string) {
    return ipcRenderer.invoke('ask-ledger:cancel', requestId) as Promise<{ ok: boolean }>;
  },
  onStream(listener: (event: unknown) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on('ask-ledger:stream', wrapped);
    return () => ipcRenderer.off('ask-ledger:stream', wrapped);
  },
  onLocalAIStatus(listener: (event: unknown) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on('ask-ledger:local-ai-status', wrapped);
    return () => ipcRenderer.off('ask-ledger:local-ai-status', wrapped);
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
  platform: process.platform,
  getDeviceSessionId(legacyDeviceId?: string) {
    return ipcRenderer.sendSync('device-session:get-id', legacyDeviceId) as string;
  },
  getRenderingSettings() {
    return ipcRenderer.invoke('window:get-rendering-settings');
  },
  getSidebarAccessibilityState() {
    return ipcRenderer.invoke('window:get-sidebar-accessibility');
  },
  getSidebarMaterialState() {
    return ipcRenderer.invoke('window:get-sidebar-material-state');
  },
  setSidebarMaterialDevelopmentSelection(
    enabled: boolean | 'under-window' | 'sidebar' | 'hud' | 'mica' | 'mica-alt' | 'acrylic'
  ) {
    return ipcRenderer.invoke('window:set-sidebar-material-development-selection', enabled);
  },
  setSidebarMaterialDevelopmentVisualEffectState(state: 'followWindow' | 'active') {
    return ipcRenderer.invoke('window:set-sidebar-material-development-visual-effect-state', state);
  },
  resetSidebarMaterialDiagnostics() {
    return ipcRenderer.invoke('window:reset-sidebar-material-diagnostics');
  },
  setRenderingMode(mode: 'auto' | 'high_quality' | 'compatibility') {
    return ipcRenderer.invoke('window:set-rendering-mode', mode);
  },
  restartApp() {
    return ipcRenderer.invoke('window:restart-app');
  },
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
    frostedBackgroundEnabled?: boolean;
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
  previewSidebarOpacity(opacity: number) {
    ipcRenderer.send('window:preview-sidebar-opacity', opacity);
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
