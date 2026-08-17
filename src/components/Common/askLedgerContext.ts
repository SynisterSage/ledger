import type { AskLedgerInitialContext } from '../../types/askLedgerContext';

const CONTEXT_STORAGE_KEY = 'ledger:ask-ledger:pending-context';
const CONTEXT_PREFIX = 'ask-ledger-context:';

export const encodeAskLedgerContext = (context: AskLedgerInitialContext) =>
  `${CONTEXT_PREFIX}${encodeURIComponent(JSON.stringify(context))}`;

export const decodeAskLedgerContext = (value: string | null | undefined): AskLedgerInitialContext | null => {
  if (!value?.startsWith(CONTEXT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(CONTEXT_PREFIX.length))) as Partial<AskLedgerInitialContext>;
    if (!parsed.resourceType || !parsed.resourceId || !parsed.title) return null;
    return { resourceType: parsed.resourceType, resourceId: parsed.resourceId, title: parsed.title };
  } catch {
    return null;
  }
};

export const readPendingAskLedgerContext = () => {
  try {
    const value = sessionStorage.getItem(CONTEXT_STORAGE_KEY);
    sessionStorage.removeItem(CONTEXT_STORAGE_KEY);
    return decodeAskLedgerContext(value);
  } catch {
    return null;
  }
};

export const openAskLedgerWithContext = (
  context: AskLedgerInitialContext,
  openHome?: () => void,
) => {
  const encoded = encodeAskLedgerContext(context);
  try {
    sessionStorage.setItem(CONTEXT_STORAGE_KEY, encoded);
  } catch {
    // The desktop focus payload remains available when session storage is unavailable.
  }

  if (window.desktopWindow?.openModule) {
    void window.desktopWindow.openModule('new-tab', { kind: 'new-tab', focusContext: encoded });
    return;
  }

  openHome?.();
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent('ledger:ask-ledger-context', { detail: context }));
  }, 0);
};

