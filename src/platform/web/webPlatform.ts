import type { LedgerPlatform, NavigationPort } from '../types/capabilities';
import {
  serializeLedgerRoute,
  type LedgerOverlayRoute,
  type LedgerRoute,
} from '../types/routes.ts';

const DEVICE_ID_KEY = 'ledger:platform-device-id:v1';

const browserNotifications = {
  getPermission() {
    if (typeof Notification === 'undefined') return 'unsupported' as const;
    return Notification.permission;
  },
  async requestPermission() {
    if (typeof Notification === 'undefined') return 'unsupported' as const;
    return await Notification.requestPermission();
  },
  async show(title: string, options?: { body?: string; tag?: string }) {
    if (this.getPermission() !== 'granted') return false;
    new Notification(title, options);
    return true;
  },
};

const browserMeetingAudio = {
  async getCapabilities() {
    const microphone =
      typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    return {
      microphone,
      systemAudio: false,
      reason: microphone
        ? 'Browser system-audio capture requires explicit screen sharing and is not enabled in Ledger Web yet.'
        : 'This browser does not expose microphone capture.',
    };
  },
  async requestMicrophone() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia)
      return 'unsupported' as const;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return 'granted' as const;
    } catch {
      return 'denied' as const;
    }
  },
};

const emitRouteIntent = (route: LedgerRoute | LedgerOverlayRoute, replace = false) => {
  const path = serializeLedgerRoute(route);
  if (typeof window === 'undefined') return;
  const state =
    route.kind === 'overlay'
      ? {
          ledgerOverlay: true,
          backgroundPath: `${window.location.pathname}${window.location.search}`,
        }
      : {};
  window.history[replace ? 'replaceState' : 'pushState'](state, '', path);
  window.dispatchEvent(
    new CustomEvent('ledger:route-intent', { detail: { route, path, replace } })
  );
};

const navigation: NavigationPort = {
  openRoute(route, options) {
    emitRouteIntent(route, options?.replace);
  },
  goBack() {
    if (typeof window !== 'undefined') window.history.back();
  },
  goForward() {
    if (typeof window !== 'undefined') window.history.forward();
  },
  openOverlay(route) {
    emitRouteIntent(route);
  },
  closeOverlay() {
    if (typeof window === 'undefined') return;
    if (window.history.state?.ledgerOverlay === true) {
      window.history.back();
      return;
    }
    const workspaceMatch = window.location.pathname.match(
      /^\/app\/w\/([^/]+)\/(?:capture|follow-up)(?:\/|$)/
    );
    if (!workspaceMatch) {
      window.history.back();
      return;
    }
    const fallbackPath = `/app/w/${workspaceMatch[1]}/home`;
    window.history.replaceState({}, '', fallbackPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
};

const externalLinks = {
  async open(url: string, options?: { newTab?: boolean }) {
    if (typeof window === 'undefined') return;
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    if (options?.newTab) window.open(url, '_blank', 'noopener,noreferrer');
    else window.location.assign(url);
  },
};

const deviceSession = {
  async getId() {
    if (typeof window === 'undefined') return 'server';
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `ledger-web-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  },
};

export const createWebPlatform = (): LedgerPlatform => ({
  kind: 'web',
  capabilities: {
    canMinimizeWindow: false,
    canDragWindow: false,
    canOpenNativePopout: false,
    canUseNativeMaterial: false,
    canUseNativeNotifications: false,
    canUseBrowserNotifications: typeof Notification !== 'undefined',
    canCaptureMicrophone:
      typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    canCaptureSystemAudio: false,
    canOpenSystemSettings: false,
    canRevealFiles: false,
    canRestartApp: false,
    canUseNativeWindowControls: false,
  },
  navigation,
  externalLinks,
  deviceSession,
  windowShell: {
    canDragWindow: false,
    async close() {},
    async minimize() {},
    async toggleFullscreen() {
      return false;
    },
  },
  notifications: browserNotifications,
  meetingAudio: browserMeetingAudio,
});
