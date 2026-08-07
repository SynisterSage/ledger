import type { LedgerOverlayRoute, LedgerRoute } from './routes';

export interface NavigationPort {
  openRoute(route: LedgerRoute, options?: { replace?: boolean }): void;
  goBack(): void;
  goForward(): void;
  openOverlay(route: LedgerOverlayRoute): void;
  closeOverlay(): void;
}

export interface ExternalLinkPort {
  open(url: string, options?: { newTab?: boolean }): Promise<void>;
}

export interface DeviceSessionPort {
  getId(): Promise<string>;
}

export interface WindowShellPort {
  close(): Promise<void>;
  minimize(): Promise<void>;
  toggleFullscreen(): Promise<boolean>;
  readonly canDragWindow: boolean;
}

export type BrowserNotificationPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export interface NotificationPort {
  getPermission(): BrowserNotificationPermission;
  requestPermission(): Promise<BrowserNotificationPermission>;
  show(title: string, options?: { body?: string; tag?: string }): Promise<boolean>;
}

export interface MeetingAudioCapabilityPort {
  getCapabilities(): Promise<{ microphone: boolean; systemAudio: boolean; reason?: string }>;
  requestMicrophone(): Promise<'granted' | 'denied' | 'unsupported'>;
}

export type LedgerPlatformKind = 'desktop' | 'web';

export type PlatformCapabilities = {
  canMinimizeWindow: boolean;
  canDragWindow: boolean;
  canOpenNativePopout: boolean;
  canUseNativeMaterial: boolean;
  canUseNativeNotifications: boolean;
  canUseBrowserNotifications: boolean;
  canCaptureMicrophone: boolean;
  canCaptureSystemAudio: boolean;
  canOpenSystemSettings: boolean;
  canRevealFiles: boolean;
  canRestartApp: boolean;
  canUseNativeWindowControls: boolean;
};

export type LedgerPlatform = {
  kind: LedgerPlatformKind;
  capabilities: PlatformCapabilities;
  navigation: NavigationPort;
  externalLinks: ExternalLinkPort;
  deviceSession: DeviceSessionPort;
  windowShell: WindowShellPort;
  notifications: NotificationPort;
  meetingAudio: MeetingAudioCapabilityPort;
};
