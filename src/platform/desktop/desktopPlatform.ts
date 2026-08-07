import type { ExternalLinkPort, LedgerPlatform, NavigationPort, WindowShellPort } from '../types/capabilities';
import type { LedgerModule, LedgerOverlayRoute, LedgerWorkspaceRoute } from '../types/routes';

const desktopWindow = () => window.desktopWindow;

const moduleForPage = (route: LedgerWorkspaceRoute): LedgerModule => {
  switch (route.page) {
    case 'home': return 'new-tab';
    case 'circle': return 'circle';
    case 'calendar': case 'event': return 'calendar';
    case 'notes': case 'note': return 'notes';
    case 'projects': case 'project': case 'task': return 'projects';
    case 'teams': case 'team': return 'teams';
    case 'dashboard': case 'today': return 'dashboard';
    case 'notifications': return 'notifications';
    case 'settings': return 'settings';
    case 'inbox': return 'inbox';
    case 'slack': return 'slack';
    case 'search': return 'new-tab';
  }
};

const focusForRoute = (route: LedgerWorkspaceRoute): ModuleFocusPayload => {
  switch (route.page) {
    case 'dashboard': return { focusSection: route.query?.section };
    case 'today': return { focusSection: 'today' };
    case 'calendar': return {
      focusDate: route.query?.date,
      focusContext: route.query?.event ? `focus-event:${route.query.event}` : route.query?.reminder ? `focus-reminder:${route.query.reminder}` : undefined,
    };
    case 'event': return { focusContext: `focus-event:${route.eventId}` };
    case 'note': return { focusNoteId: route.noteId, focusContext: route.query?.view ? `note-view:${route.query.view}` : undefined };
    case 'project': return { focusProjectId: route.projectId, focusTaskId: route.taskId };
    case 'task': return { focusTaskId: route.taskId };
    case 'team': return { focusContext: `team:${route.teamId}` };
    case 'circle': return { focusContext: route.query?.person ?? route.query?.context };
    case 'inbox': return { focusInboxId: route.query?.item, focusSection: route.query?.section };
    case 'notifications': return { focusContext: route.query?.item, focusSection: route.query?.filter };
    case 'search': return { focusContext: `search:${route.query.q}` };
    case 'settings': return { focusContext: route.section };
    default: return {};
  }
};

const navigation: NavigationPort = {
  openRoute(route) {
    if (route.kind !== 'workspace') return;
    const kind = moduleForPage(route);
    void desktopWindow()?.openModule(kind, { kind, ...focusForRoute(route) });
  },
  goBack() { void desktopWindow()?.goBackWorkspaceWindow?.(); },
  goForward() { void desktopWindow()?.goForwardWorkspaceWindow?.(); },
  openOverlay(route: LedgerOverlayRoute) {
    const kind = route.page === 'follow-up' ? 'quick-follow-up' : `quick-${route.action}`;
    void desktopWindow()?.openModule(kind as ModuleWindowKind, {
      kind: kind as ModuleWindowKind,
      focusProjectId: route.page === 'capture' ? route.projectId : undefined,
      focusDate: route.page === 'capture' ? route.date : undefined,
      focusContext: route.page === 'follow-up' ? route.entityId : route.page === 'capture' ? route.context : undefined,
    });
  },
  async closeOverlay() {
    const kind = (await desktopWindow()?.getWorkspaceNavigationState?.())?.currentModule;
    if (kind?.startsWith('quick-')) await desktopWindow()?.closeModule(kind);
  },
};

const externalLinks: ExternalLinkPort = {
  async open(url) {
    await desktopWindow()?.openExternal(url);
  },
};

const deviceSession = {
  async getId() {
    return desktopWindow()?.getDeviceSessionId() ?? '';
  },
};

const windowShell: WindowShellPort = {
  get canDragWindow() { return true; },
  async close() {
    const kind = (await desktopWindow()?.getWorkspaceNavigationState?.())?.currentModule;
    if (kind) await desktopWindow()?.closeModule(kind);
  },
  async minimize() {
    const kind = (await desktopWindow()?.getWorkspaceNavigationState?.())?.currentModule;
    if (kind) await desktopWindow()?.minimizeModule(kind);
  },
  async toggleFullscreen() {
    const kind = (await desktopWindow()?.getWorkspaceNavigationState?.())?.currentModule;
    return kind ? (await desktopWindow()?.toggleModuleFullscreen(kind)) ?? false : false;
  },
};

export const createDesktopPlatform = (): LedgerPlatform => ({
  kind: 'desktop',
  capabilities: {
    canMinimizeWindow: true,
    canDragWindow: true,
    canOpenNativePopout: true,
    canUseNativeMaterial: true,
    canUseNativeNotifications: true,
    canUseBrowserNotifications: false,
    canCaptureMicrophone: true,
    canCaptureSystemAudio: true,
    canOpenSystemSettings: true,
    canRevealFiles: true,
    canRestartApp: true,
    canUseNativeWindowControls: true,
  },
  navigation,
  externalLinks,
  deviceSession,
  windowShell,
  notifications: {
    getPermission: () => 'granted',
    async requestPermission() { return 'granted'; },
    async show() { return false; },
  },
  meetingAudio: {
    async getCapabilities() { return { microphone: Boolean(window.meetingAudio), systemAudio: Boolean(window.meetingAudio) }; },
    async requestMicrophone() { return window.meetingAudio ? 'granted' : 'unsupported'; },
  },
});

type ModuleFocusPayload = {
  focusDate?: string;
  focusProjectId?: string;
  focusNoteId?: string;
  focusTaskId?: string;
  focusInboxId?: string;
  focusContext?: string;
  focusSection?: string;
};
