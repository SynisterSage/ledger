const DRAFT_PREFIX = 'ledger:web:draft:';

export const webDraftKey = (...parts: Array<string | null | undefined>) =>
  `${DRAFT_PREFIX}${parts.map((part) => encodeURIComponent(String(part ?? ''))).join(':')}`;

export const readWebDraft = <T>(key: string): T | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const writeWebDraft = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), value }));
  } catch {
    // Draft recovery is best effort and must never block the editor.
  }
};

export const removeWebDraft = (key: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures (private browsing/quota); server data remains authoritative.
  }
};

export const unwrapWebDraft = <T>(payload: { value?: T } | null): T | null =>
  payload?.value ?? null;
