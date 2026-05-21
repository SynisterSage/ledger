import {
  API_BASE,
  clearStoredToken,
  getStoredToken,
  getStoredWorkspaceId,
  saveBrowserCapture,
  setStoredWorkspaceId,
  type BrowserCapturePayload,
} from './shared';

const MENUS = {
  savePage: 'ledger-save-page',
  saveSelection: 'ledger-save-selection',
};

type ContextMenuClickInfo = {
  menuItemId: string | number;
  selectionText?: string | null;
};

type RuntimeMessage = {
  type?: string;
  payload?: BrowserCapturePayload;
};

type MessageResponder = (response: { ok: boolean; error?: string; item?: unknown; connected?: boolean; apiBase?: string }) => void;

const setBadge = async (text: string, color: string) => {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
  } catch {
    // Ignore badge failures in older Chromium builds.
  }
};

const showNotification = async (title: string, message: string) => {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title,
      message,
    });
  } catch {
    // Notifications are best-effort on older Chromium builds.
  }
};

const pulseBadge = async (text: string, color: string) => {
  await setBadge(text, color);
  setTimeout(() => {
    void setBadge('', '#00000000');
  }, 1800);
};

const openSetupSurface = async () => {
  try {
    await chrome.runtime.openOptionsPage();
    return;
  } catch {
    // Fall through to opening the options page in a tab.
  }

  const url = chrome.runtime.getURL('options.html');
  await chrome.tabs.create({ url });
};

const ensureContextMenus = () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENUS.savePage,
      title: 'Save page to Ledger',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: MENUS.saveSelection,
      title: 'Save selection to Ledger',
      contexts: ['selection'],
    });
  });
};

const getActiveTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
};

const captureSelectedText = async (tabId: number) => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.getSelection?.()?.toString() ?? '',
  });
  return String(result?.result ?? '').trim();
};

const preparePageCapture = async (): Promise<BrowserCapturePayload> => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('No active tab found.');
  }

  return {
    capture_type: 'link',
    title: String(tab.title ?? '').trim() || 'Page link',
    body: null,
    source_url: String(tab.url ?? '').trim() || null,
    workspace_id: (await getStoredWorkspaceId()) ?? null,
    project_id: null,
    raw_payload: {
      kind: 'page',
      tab_id: tab.id,
      title: tab.title ?? null,
      url: tab.url ?? null,
    },
  };
};

const prepareSelectionCapture = async (selectionText?: string | null): Promise<BrowserCapturePayload> => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('No active tab found.');
  }

  const selectedText = String(selectionText ?? '').trim() || (await captureSelectedText(tab.id));
  if (!selectedText) {
    throw new Error('No selected text found.');
  }

  return {
    capture_type: 'selection',
    title: selectedText.split(/\r?\n/)[0].trim().slice(0, 80) || String(tab.title ?? '').trim() || 'Selected text',
    body: selectedText,
    source_url: String(tab.url ?? '').trim() || null,
    workspace_id: (await getStoredWorkspaceId()) ?? null,
    project_id: null,
    raw_payload: {
      kind: 'selection',
      tab_id: tab.id,
      title: tab.title ?? null,
      url: tab.url ?? null,
      selection: selectedText,
    },
  };
};

const saveCaptureFromMenu = async (type: 'page' | 'selection', selectionText?: string | null) => {
  const token = await getStoredToken();
  if (!token) {
    await openSetupSurface();
    await showNotification('Ledger is not connected', 'Paste your extension token in Ledger settings.');
    return;
  }

  const payload =
    type === 'selection' ? await prepareSelectionCapture(selectionText) : await preparePageCapture();
  const result = await saveBrowserCapture(payload);

  if (result.ok) {
    const workspaceId = result.item.workspace_id ?? payload.workspace_id ?? null;
    if (workspaceId) {
      await setStoredWorkspaceId(workspaceId);
    }
    await pulseBadge('OK', '#ff5f40');
    await showNotification('Saved to Ledger', type === 'selection' ? 'Selection sent to Inbox.' : 'Page sent to Inbox.');
    return;
  }

  throw new Error('Capture failed.');
};

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenus();
  void setBadge('', '#00000000');
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info: ContextMenuClickInfo) => {
  try {
    if (info.menuItemId === MENUS.savePage) {
      await saveCaptureFromMenu('page');
      return;
    }

    if (info.menuItemId === MENUS.saveSelection) {
      await saveCaptureFromMenu('selection', info.selectionText ?? null);
    }
  } catch {
    await pulseBadge('!', '#c2410c');
    await showNotification('Ledger save failed', 'Could not send the capture to Inbox.');
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender: unknown, sendResponse: MessageResponder) => {
  if (!message || typeof message !== 'object') return false;

  const type = String((message as { type?: string }).type ?? '');

  if (type === 'ledger-browser:save') {
    void (async () => {
      try {
        const payload = (message as { payload?: BrowserCapturePayload }).payload;
        if (!payload) throw new Error('Missing capture payload.');

        const token = await getStoredToken();
        if (!token) {
          await openSetupSurface();
          sendResponse({ ok: false, error: 'Connect Ledger first.' });
          return;
        }

        const response = await saveBrowserCapture(payload);
        if (response.item.workspace_id) {
          await setStoredWorkspaceId(response.item.workspace_id);
        }
        await showNotification('Saved to Ledger', 'Capture sent to Inbox.');
        sendResponse({ ok: true, item: response.item });
      } catch (error) {
        await showNotification('Ledger save failed', error instanceof Error ? error.message : 'Could not save.');
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Save failed.' });
      }
    })();
    return true;
  }

  if (type === 'ledger-browser:ping') {
    void (async () => {
      try {
        const token = await getStoredToken();
        sendResponse({ ok: true, connected: Boolean(token), apiBase: API_BASE });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  return false;
});
