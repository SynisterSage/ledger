export type LedgerSessionPlatform = 'desktop' | 'ios' | 'android' | 'web' | 'extension';

const DEVICE_ID_STORAGE_KEY = 'ledger:device-id:v1';

const isElectronRenderer = () =>
  typeof window !== 'undefined' && Boolean((window as Window & { desktopWindow?: unknown }).desktopWindow);

const isExtensionContext = () =>
  typeof window !== 'undefined' && window.location.protocol === 'chrome-extension:';

const getNavigatorUserAgent = () => {
  if (typeof navigator === 'undefined') return '';
  return String(navigator.userAgent ?? '');
};

export const getLedgerSessionPlatform = (): LedgerSessionPlatform => {
  if (isElectronRenderer()) return 'desktop';
  if (isExtensionContext()) return 'extension';

  const userAgent = getNavigatorUserAgent().toLowerCase();
  if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ipod')) {
    return 'ios';
  }
  if (userAgent.includes('android')) {
    return 'android';
  }
  return 'web';
};

export const getLedgerSessionAppName = (): string => {
  switch (getLedgerSessionPlatform()) {
    case 'desktop':
      return 'Ledger Desktop';
    case 'ios':
      return 'Ledger Mobile';
    case 'android':
      return 'Ledger Mobile';
    case 'extension':
      return 'Ledger Browser Extension';
    default:
      return 'Ledger Web';
  }
};

export const getLedgerSessionDeviceName = (): string => {
  if (typeof navigator === 'undefined') return getLedgerSessionAppName();

  if (getLedgerSessionPlatform() === 'desktop') {
    return 'Ledger Desktop';
  }

  if (getLedgerSessionPlatform() === 'extension') {
    return 'Browser extension';
  }

  const userAgent = getNavigatorUserAgent();
  if (userAgent.includes('iPhone')) return 'iPhone';
  if (userAgent.includes('iPad')) return 'iPad';
  if (userAgent.includes('Android')) return 'Android phone';

  return getLedgerSessionAppName();
};

export const getOrCreateLedgerDeviceId = (): string => {
  if (typeof window === 'undefined') return 'server';
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)?.trim();
  if (existing) return existing;

  const generated =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `ledger-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
  return generated;
};

export const buildLedgerSessionHeaders = () => ({
  'X-Ledger-Device-Id': getOrCreateLedgerDeviceId(),
  'X-Ledger-Platform': getLedgerSessionPlatform(),
  'X-Ledger-Device-Name': getLedgerSessionDeviceName(),
  'X-Ledger-App-Name': getLedgerSessionAppName(),
});

export const formatLedgerSessionPlatformLabel = (platform: string) => {
  switch (platform) {
    case 'desktop':
      return 'Desktop app';
    case 'ios':
      return 'iPhone';
    case 'android':
      return 'Android';
    case 'extension':
      return 'Browser extension';
    case 'web':
      return 'Web';
    default:
      return 'Ledger';
  }
};

export const formatLedgerSessionRelativeTime = (value: string | null | undefined) => {
  if (!value) return 'Last active recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Last active recently';

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'Active now';
  if (diffMs < 3_600_000) {
    const minutes = Math.max(1, Math.round(diffMs / 60_000));
    return `Last active ${minutes}m ago`;
  }
  if (diffMs < 86_400_000) {
    const hours = Math.max(1, Math.round(diffMs / 3_600_000));
    return `Last active ${hours}h ago`;
  }
  if (diffMs < 604_800_000) {
    return `Last active ${date.toLocaleDateString([], { weekday: 'short' })}`;
  }

  return `Last active ${date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })}`;
};
