import './popup.css';
import {
  clearStoredToken,
  firstLine,
  loadExtensionMe,
  loadExtensionWorkspaces,
  normalizeUrl,
  saveBrowserCapture,
  setStoredToken,
  setStoredWorkspaceId,
  truncate,
  type BrowserCapturePayload,
  type CaptureType,
  type ExtensionWorkspace,
} from './shared';

type PopupState = {
  isLoading: boolean;
  isSaving: boolean;
  hasToken: boolean;
  tokenInput: string;
  captureType: CaptureType;
  pageTitle: string;
  pageUrl: string;
  selectionText: string;
  title: string;
  body: string;
  workspaceId: string | null;
  workspaces: ExtensionWorkspace[];
  defaultWorkspaceId: string | null;
  statusText: string;
  statusTone: '' | 'success' | 'error';
};

const state: PopupState = {
  isLoading: true,
  isSaving: false,
  hasToken: false,
  tokenInput: '',
  captureType: 'link',
  pageTitle: '',
  pageUrl: '',
  selectionText: '',
  title: '',
  body: '',
  workspaceId: null,
  workspaces: [],
  defaultWorkspaceId: null,
  statusText: '',
  statusTone: '',
};

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Popup mount point missing.');
}

const extensionChrome = globalThis.chrome as typeof chrome | undefined;
const hasExtensionApi = Boolean(extensionChrome?.storage?.local && extensionChrome?.tabs);

const requireExtensionApi = () => {
  if (!hasExtensionApi) {
    throw new Error('Ledger extension APIs are unavailable. Load the unpacked extension in Chrome.');
  }
  return extensionChrome as typeof chrome;
};

const storageGet = (keys: string[] | string) =>
  new Promise<Record<string, unknown>>((resolve) => {
    requireExtensionApi().storage.local.get(keys, resolve);
  });

const loadActiveTab = async () => {
  const tabs = await requireExtensionApi().tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0] ?? null;
  const tabId = tab?.id ?? null;
  let selection = '';

  if (tabId !== null) {
    try {
      const [result] = await requireExtensionApi().scripting.executeScript({
        target: { tabId },
        func: () => window.getSelection?.()?.toString() ?? '',
      });
      selection = String(result?.result ?? '').trim();
    } catch {
      selection = '';
    }
  }

  state.pageTitle = String(tab?.title ?? '').trim();
  state.pageUrl = normalizeUrl(tab?.url) ?? '';
  state.selectionText = selection;
};

const setStatus = (text: string, tone: PopupState['statusTone'] = '') => {
  state.statusText = text;
  state.statusTone = tone;
};

const applyDefaults = () => {
  if (state.captureType === 'selection') {
    const selectionTitle = firstLine(state.selectionText) || state.pageTitle || 'Selected text';
    state.title = truncate(selectionTitle, 300);
    state.body = state.selectionText;
    return;
  }

  if (state.captureType === 'link') {
    state.title = truncate(state.pageTitle || 'Page link', 300);
    state.body = '';
    return;
  }

  if (state.captureType === 'manual') {
    if (!state.title) {
      state.title = '';
    }
    return;
  }
};

const setCaptureType = (nextType: CaptureType) => {
  state.captureType = nextType;
  applyDefaults();
  render();
};

const populateWorkspaceState = (workspaceId: string | null, workspaces: ExtensionWorkspace[]) => {
  state.defaultWorkspaceId = workspaceId;
  state.workspaces = workspaces;
  state.workspaceId =
    workspaceId && workspaces.some((workspace) => workspace.id === workspaceId)
      ? workspaceId
      : workspaces[0]?.id ?? workspaceId;
};

const buildCapturePayload = (): BrowserCapturePayload => ({
  capture_type: state.captureType,
  title:
    truncate(state.title || (state.captureType === 'manual' ? 'Manual note' : state.pageTitle), 300) ||
    (state.captureType === 'manual' ? 'Manual note' : 'Page link'),
  body:
    state.captureType === 'manual'
      ? state.body.trim() || null
      : state.body.trim() || state.selectionText.trim() || null,
  source_url: state.pageUrl || null,
  workspace_id: state.workspaceId,
  project_id: null,
  raw_payload: {
    source: 'browser-extension',
    capture_type: state.captureType,
    page_title: state.pageTitle,
  },
});

const canSave = () => {
  if (state.isLoading || state.isSaving || !state.hasToken) return false;
  if (!state.pageTitle && !state.pageUrl) return false;
  if (state.captureType === 'selection' && !state.selectionText.trim()) return false;
  if (state.captureType === 'manual') {
    return Boolean(state.title.trim() || state.body.trim());
  }
  return Boolean(state.title.trim() || state.pageTitle.trim());
};

const saveToken = async () => {
  const token = state.tokenInput.trim();
  if (!token) {
    setStatus('Paste your Ledger extension token.', 'error');
    render();
    return;
  }

  await setStoredToken(token);
  state.hasToken = true;
  setStatus('Connected to Ledger.', 'success');
  await bootstrapWorkspace();
  if (!state.hasToken) {
    render();
    return;
  }
  await bootstrapCaptureData();
  render();
};

const disconnectToken = async () => {
  await clearStoredToken();
  state.hasToken = false;
  state.workspaces = [];
  state.workspaceId = null;
  state.defaultWorkspaceId = null;
  state.tokenInput = '';
  setStatus('Disconnected.', '');
  render();
};

const bootstrapWorkspace = async () => {
  try {
    const me = await loadExtensionMe();
    const workspacesResponse = await loadExtensionWorkspaces().catch(() => null);
    populateWorkspaceState(
      me.default_workspace_id ?? null,
      workspacesResponse?.workspaces ?? (me.default_workspace ? [me.default_workspace] : [])
    );
    if (!state.workspaceId && state.defaultWorkspaceId) {
      state.workspaceId = state.defaultWorkspaceId;
    }
    if (state.workspaceId) {
      await setStoredWorkspaceId(state.workspaceId);
    }
  } catch (error) {
    await clearStoredToken();
    state.hasToken = false;
    state.workspaces = [];
    state.workspaceId = null;
    state.defaultWorkspaceId = null;
    state.tokenInput = '';
    setStatus(error instanceof Error ? error.message : 'Could not load workspace.', 'error');
  }
};

const bootstrapCaptureData = async () => {
  await loadActiveTab();
  applyDefaults();
};

const submitCapture = async () => {
  if (!canSave()) return;

  state.isSaving = true;
  setStatus('Saving to Ledger Inbox...', '');
  render();

  try {
    const result = await saveBrowserCapture(buildCapturePayload());
    state.workspaceId = result.item.workspace_id ?? state.workspaceId;
    if (state.workspaceId) {
      await setStoredWorkspaceId(state.workspaceId);
    }
    setStatus('Saved to Ledger Inbox.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not save.', 'error');
  } finally {
    state.isSaving = false;
    render();
  }
};

const renderWorkspaceSelect = () => {
  if (!state.hasToken || state.workspaces.length === 0) {
    return `<div class="meta"><strong>Workspace</strong><div>${state.workspaceId ? 'Default workspace' : 'Ledger will choose automatically'}</div></div>`;
  }

  if (state.workspaces.length === 1) {
    const workspace = state.workspaces[0];
    return `<div class="meta"><strong>Workspace</strong><div>${workspace.name}</div></div>`;
  }

  const options = state.workspaces
    .map(
      (workspace) =>
        `<option value="${workspace.id}" ${workspace.id === state.workspaceId ? 'selected' : ''}>${workspace.name}</option>`
    )
    .join('');

  return `
    <div class="field">
      <label for="workspace">Workspace</label>
      <select id="workspace" class="select">${options}</select>
    </div>
  `;
};

const renderCaptureFields = () => {
  const selectionPreview =
    state.captureType === 'selection'
      ? `<div class="note-box">${state.selectionText ? state.selectionText : 'No selection found yet.'}</div>`
      : '';

  return `
    <div class="section">
      <div class="label-row">
        <div class="label">Capture type</div>
        <div class="segment" role="tablist" aria-label="Capture type">
          <button data-active="${state.captureType === 'link'}" data-type="link">Link</button>
          <button data-active="${state.captureType === 'selection'}" data-type="selection">Selection</button>
          <button data-active="${state.captureType === 'manual'}" data-type="manual">Note</button>
        </div>
      </div>

      <div class="field">
        <label for="title">Title</label>
        <input id="title" class="input" value="${escapeHtml(state.title)}" placeholder="Untitled capture" />
      </div>

      <div class="field">
        <label for="body">Body</label>
        <textarea id="body" class="textarea" placeholder="Add a quick note...">${escapeHtml(state.body)}</textarea>
      </div>

      ${selectionPreview}
    </div>
  `;
};

const escapeHtml = (value: string) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char] ?? char;
  });

const render = () => {
  app.innerHTML = `
    <div class="panel">
      <div class="header">
        <p class="eyebrow">Ledger</p>
        <h1 class="title">Save to Inbox</h1>
        <p class="subtitle">Save a page, selection, or quick note.</p>
      </div>

      <div class="section">
        <div class="label-row">
          <div class="label">Current page</div>
          <button class="mini-link" id="refresh">Refresh</button>
        </div>
        <div class="meta">
          <strong>${escapeHtml(state.pageTitle || 'No active page')}</strong>
          <div class="page-url">${escapeHtml(state.pageUrl || 'Open a web page to capture it.')}</div>
        </div>
      </div>

      ${state.hasToken ? renderCaptureFields() : ''}

      <div class="section">
        ${state.hasToken ? renderWorkspaceSelect() : ''}
        ${
          !state.hasToken
            ? `
              <div class="field">
                <label for="token">Connect Ledger</label>
                <div class="token-wrap">
                  <input id="token" class="input" type="password" placeholder="Paste extension token" value="${escapeHtml(
                    state.tokenInput
                  )}" />
                  <button class="button" id="save-token">Save</button>
                </div>
              </div>
            `
            : `
              <div class="label-row" style="margin-bottom: 0;">
                <div class="meta">Connected to Ledger</div>
                <button class="mini-link" id="disconnect">Disconnect</button>
              </div>
            `
        }
      </div>

      <div class="footer">
        <div class="status" data-tone="${state.statusTone}">${escapeHtml(state.statusText)}</div>
        <button class="button primary" id="save" ${canSave() ? '' : 'disabled'}>${
          state.isSaving ? 'Saving...' : 'Save to Ledger'
        }</button>
      </div>
    </div>
  `;

  const saveTokenButton = document.querySelector<HTMLButtonElement>('#save-token');
  const tokenInput = document.querySelector<HTMLInputElement>('#token');
  const titleInput = document.querySelector<HTMLInputElement>('#title');
  const bodyInput = document.querySelector<HTMLTextAreaElement>('#body');
  const saveButton = document.querySelector<HTMLButtonElement>('#save');
  const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect');
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh');
  const workspaceSelect = document.querySelector<HTMLSelectElement>('#workspace');

  saveTokenButton?.addEventListener('click', () => {
    if (tokenInput) {
      state.tokenInput = tokenInput.value;
      void saveToken();
    }
  });

  tokenInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      state.tokenInput = tokenInput.value;
      void saveToken();
    }
  });

  titleInput?.addEventListener('input', () => {
    state.title = titleInput.value;
  });

  bodyInput?.addEventListener('input', () => {
    state.body = bodyInput.value;
  });

  disconnectButton?.addEventListener('click', () => {
    void disconnectToken();
  });

  refreshButton?.addEventListener('click', () => {
    void bootstrapCaptureData().then(() => render());
  });

  workspaceSelect?.addEventListener('change', async () => {
    state.workspaceId = workspaceSelect.value || null;
    if (state.workspaceId) {
      await setStoredWorkspaceId(state.workspaceId);
    }
  });

  saveButton?.addEventListener('click', () => {
    void submitCapture();
  });

  app.querySelectorAll<HTMLButtonElement>('.segment button').forEach((button) => {
    button.addEventListener('click', () => {
      const nextType = button.dataset.type as CaptureType;
      if (nextType) {
        setCaptureType(nextType);
      }
    });
  });
};

const bootstrap = async () => {
  try {
    const stored = (await storageGet(['extension_token', 'default_workspace_id'])) as {
      extension_token?: string;
      default_workspace_id?: string | null;
    };

    state.tokenInput = String(stored.extension_token ?? '').trim();
    state.hasToken = Boolean(state.tokenInput);
    state.workspaceId = stored.default_workspace_id ?? null;

    if (state.hasToken) {
      await bootstrapWorkspace();
      if (!state.hasToken) {
        state.isLoading = false;
        render();
        return;
      }
      await bootstrapCaptureData();
    } else {
      await loadActiveTab();
      applyDefaults();
    }
  } catch (error) {
    state.statusTone = 'error';
    state.statusText =
      error instanceof Error ? error.message : 'Ledger extension APIs are unavailable.';
    state.hasToken = false;
  }

  state.isLoading = false;
  render();
};

void bootstrap();
