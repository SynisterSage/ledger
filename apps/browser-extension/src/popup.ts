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
  isLinkNoteVisible: boolean;
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
  isLinkNoteVisible: false,
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

const extensionChrome = typeof chrome === 'undefined' ? undefined : chrome;
const hasExtensionApi = Boolean(extensionChrome?.storage?.local && extensionChrome?.tabs);
const LOADING_MIN_MS = 650;

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const shouldDiscardToken = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /connect ledger first|unauthori[sz]ed|forbidden|invalid token|401/i.test(message);
};

const formatPageSource = (value: string) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Open a web page to capture it.';

  try {
    const url = new URL(raw);
    const path = url.pathname === '/' ? '' : url.pathname;
    const query = url.search || '';
    return truncate(`${url.hostname}${path}${query}`, 120);
  } catch {
    return truncate(raw.replace(/^https?:\/\//i, ''), 120);
  }
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
  state.isLinkNoteVisible = nextType === 'link' ? Boolean(state.body.trim()) : true;
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
  setStatus('', '');
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
    if (shouldDiscardToken(error)) {
      await clearStoredToken();
    }
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
  state.isLinkNoteVisible = state.captureType !== 'link' || Boolean(state.body.trim());
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

const renderWorkspaceSection = () => {
  if (state.workspaces.length <= 1) {
    const workspace = state.workspaces[0] ?? null;
    return `
      <div class="meta-row">
        <div>
          <label class="section-label">Workspace</label>
          <div class="value">${escapeHtml(workspace?.name ?? 'Default workspace')}</div>
        </div>
        <button class="text-action muted" id="disconnect">Disconnect</button>
      </div>
    `;
  }

  const options = state.workspaces
    .map(
      (workspace) =>
        `<option value="${workspace.id}" ${workspace.id === state.workspaceId ? 'selected' : ''}>${escapeHtml(
          workspace.name
        )}</option>`
    )
    .join('');

  return `
    <div class="field">
      <label for="workspace">Workspace</label>
      <select id="workspace" class="select">${options}</select>
    </div>
    <div class="section-foot">
      <div class="meta">Connected to Ledger.</div>
      <button class="text-action muted" id="disconnect">Disconnect</button>
    </div>
  `;
};

const renderOnboarding = () => `
  <main class="popup-shell onboarding-shell">
    <header class="header onboarding-header">
      <div class="brand-row">
        <img class="brand-mark" src="/logo.svg" alt="Ledger" />
        <span class="brand-name">Ledger</span>
      </div>
      <h1 class="title">Connect to Ledger</h1>
      <p class="subtitle">Paste your extension token to save captures into Inbox.</p>
    </header>

    <div class="divider divider-header"></div>

    <section class="onboarding-card">
      <div class="field onboarding-field">
        <label for="token">Extension token</label>
        <input id="token" class="input" type="password" placeholder="Paste extension token" value="${escapeHtml(
          state.tokenInput
        )}" />
      </div>

      <div class="section-foot onboarding-foot">
        <div class="meta">Stored locally in Chrome and reused here.</div>
        <button class="button primary onboarding-button" id="save-token">Connect</button>
      </div>
    </section>

    <div class="status" data-tone="${state.statusTone}">${escapeHtml(state.statusText)}</div>
  </main>
`;

const renderLoadingState = () => `
  <div class="loading-shell">
    <img class="loading-mark" src="/logo.svg" alt="Ledger" />
    <div class="loading-copy">
      <div class="loading-title">Ledger</div>
      <div class="loading-subtitle">Preparing capture panel…</div>
    </div>
  </div>
`;

const renderCaptureFields = () => {
  const noteBody =
    state.captureType === 'link' && !state.isLinkNoteVisible
      ? `<button class="text-action note-toggle" id="show-note">Add note</button>`
      : `
        <div class="field">
          <label for="body">${state.captureType === 'selection' ? 'Selection' : 'Body'}</label>
          <textarea id="body" class="textarea" placeholder="Add a quick note...">${escapeHtml(state.body)}</textarea>
        </div>
      `;

  const selectionPreview =
    state.captureType === 'selection'
      ? `<div class="selection-preview">${state.selectionText ? escapeHtml(state.selectionText) : 'No selection found yet.'}</div>`
      : '';

  return `
    <div class="section">
      <div class="section-header">
        <div>
          <div class="section-label">Capture</div>
          <div class="section-kicker">Pick what to save.</div>
        </div>
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

      ${noteBody}
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
  if (state.isLoading) {
    app.innerHTML = renderLoadingState();
    return;
  }

  if (!state.hasToken) {
    app.innerHTML = renderOnboarding();

    const saveTokenButton = document.querySelector<HTMLButtonElement>('#save-token');
    const tokenInput = document.querySelector<HTMLInputElement>('#token');

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

    return;
  }

  app.innerHTML = `
    <main class="popup-shell">
      <header class="header">
        <div class="brand-row">
          <img class="brand-mark" src="/logo.svg" alt="Ledger" />
          <span class="brand-name">Ledger</span>
        </div>
        <h1 class="title">Save to Inbox</h1>
        <p class="subtitle">Save a page, selection, or quick note.</p>
      </header>

      <div class="divider divider-header"></div>

      <section class="section section-current">
        <div class="section-header compact">
          <div class="section-label">Current page</div>
          <button class="icon-button" id="refresh" aria-label="Refresh current page">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20 12a8 8 0 0 1-13.66 5.66L4 15.32" />
              <path d="M4 19.5v-4.18h4.18" />
              <path d="M4 12a8 8 0 0 1 13.66-5.66L20 8.68" />
              <path d="M20 4.5v4.18h-4.18" />
            </svg>
          </button>
        </div>
        <div class="page-title">${escapeHtml(state.pageTitle || 'No active page')}</div>
        <div class="page-source">${escapeHtml(formatPageSource(state.pageUrl))}</div>
      </section>

      <div class="divider"></div>

      ${state.hasToken ? renderCaptureFields() : ''}

      <div class="section">
        ${renderWorkspaceSection()}
      </div>

      <div class="divider"></div>

      <div class="status" data-tone="${state.statusTone}">${escapeHtml(state.statusText)}</div>
      <button class="button primary save-button" id="save" ${canSave() ? '' : 'disabled'}>${
        state.isSaving ? 'Saving...' : 'Save to Ledger'
      }</button>
    </main>
  `;

  const titleInput = document.querySelector<HTMLInputElement>('#title');
  const bodyInput = document.querySelector<HTMLTextAreaElement>('#body');
  const saveButton = document.querySelector<HTMLButtonElement>('#save');
  const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect');
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh');
  const workspaceSelect = document.querySelector<HTMLSelectElement>('#workspace');
  const noteToggleButton = document.querySelector<HTMLButtonElement>('#show-note');

  titleInput?.addEventListener('input', () => {
    state.title = titleInput.value;
  });

  bodyInput?.addEventListener('input', () => {
    state.body = bodyInput.value;
  });

  noteToggleButton?.addEventListener('click', () => {
    state.isLinkNoteVisible = true;
    render();
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
  const startedAt = performance.now();
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
      if (state.hasToken) {
        await bootstrapCaptureData();
      }
    }
  } catch (error) {
    state.statusTone = 'error';
    state.statusText =
      error instanceof Error ? error.message : 'Ledger extension APIs are unavailable.';
    state.hasToken = false;
  }

  const elapsed = performance.now() - startedAt;
  if (elapsed < LOADING_MIN_MS) {
    await sleep(LOADING_MIN_MS - elapsed);
  }
  state.isLoading = false;
  render();
};

render();
void bootstrap();
