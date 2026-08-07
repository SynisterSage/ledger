export const BROWSER_INVITE_CONTINUATION_KEY = 'ledger:browser-invite:v1';

const MAX_INVITE_TOKEN_LENGTH = 2048;

const isBrowser = () => typeof window !== 'undefined' && !window.desktopWindow;

export const readBrowserInviteContinuation = (): string | null => {
  if (!isBrowser()) return null;
  try {
    const token = window.sessionStorage.getItem(BROWSER_INVITE_CONTINUATION_KEY)?.trim() ?? '';
    return token && token.length <= MAX_INVITE_TOKEN_LENGTH ? token : null;
  } catch {
    return null;
  }
};

export const writeBrowserInviteContinuation = (token: string): boolean => {
  if (!isBrowser()) return false;
  const normalized = token.trim();
  if (!normalized || normalized.length > MAX_INVITE_TOKEN_LENGTH) return false;
  try {
    window.sessionStorage.setItem(BROWSER_INVITE_CONTINUATION_KEY, normalized);
    return true;
  } catch {
    return false;
  }
};

export const clearBrowserInviteContinuation = (): void => {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(BROWSER_INVITE_CONTINUATION_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
};
