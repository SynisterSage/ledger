import './options.css';
import {
  clearStoredToken,
  loadExtensionMe,
  loadExtensionWorkspaces,
  setStoredToken,
  setStoredWorkspaceId,
  type ExtensionWorkspace,
} from './shared';

type OptionsState = {
  tokenInput: string;
  workspaceId: string | null;
  defaultWorkspaceId: string | null;
  workspaces: ExtensionWorkspace[];
  statusText: string;
  statusTone: '' | 'success' | 'error';
};

const state: OptionsState = {
  tokenInput: '',
  workspaceId: null,
  defaultWorkspaceId: null,
  workspaces: [],
  statusText: '',
  statusTone: '',
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Options mount point missing.');
}

const storageGet = (keys: string[] | string) =>
  new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });

const storageSet = (value: Record<string, unknown>) =>
  new Promise<void>((resolve) => {
    chrome.storage.local.set(value, () => resolve());
  });

const setStatus = (text: string, tone: OptionsState['statusTone'] = '') => {
  state.statusText = text;
  state.statusTone = tone;
};

const loadState = async () => {
  const stored = (await storageGet(['extension_token', 'default_workspace_id'])) as {
    extension_token?: string;
    default_workspace_id?: string | null;
  };
  state.tokenInput = String(stored.extension_token ?? '').trim();
  state.workspaceId = stored.default_workspace_id ?? null;
};

const bootstrapWorkspace = async () => {
  if (!state.tokenInput.trim()) {
    state.workspaces = [];
    state.defaultWorkspaceId = null;
    return;
  }

  try {
    const me = await loadExtensionMe();
    const workspacesResponse = await loadExtensionWorkspaces().catch(() => null);
    state.defaultWorkspaceId = me.default_workspace_id ?? null;
    state.workspaces = workspacesResponse?.workspaces ?? (me.default_workspace ? [me.default_workspace] : []);
    if (!state.workspaceId) {
      state.workspaceId = state.defaultWorkspaceId;
    }
    if (state.workspaceId) {
      await setStoredWorkspaceId(state.workspaceId);
    }
    setStatus('Connected to Ledger.', 'success');
  } catch (error) {
    await clearStoredToken();
    state.tokenInput = '';
    state.workspaceId = null;
    state.defaultWorkspaceId = null;
    state.workspaces = [];
    setStatus(error instanceof Error ? error.message : 'Could not load workspace.', 'error');
  }
};

const saveToken = async () => {
  const token = state.tokenInput.trim();
  if (!token) {
    setStatus('Paste your Ledger extension token.', 'error');
    render();
    return;
  }

  await setStoredToken(token);
  setStatus('Token saved. Verifying workspace...', '');
  render();
  await bootstrapWorkspace();
  render();
};

const disconnect = async () => {
  await clearStoredToken();
  state.tokenInput = '';
  state.workspaceId = null;
  state.defaultWorkspaceId = null;
  state.workspaces = [];
  setStatus('Disconnected.', '');
  render();
};

const render = () => {
  const workspaceOptions = state.workspaces
    .map(
      (workspace) =>
        `<option value="${workspace.id}" ${workspace.id === state.workspaceId ? 'selected' : ''}>${workspace.name}</option>`
    )
    .join('');

  app.innerHTML = `
    <div class="card">
      <div class="header">
        <p class="eyebrow">Ledger Browser Extension</p>
        <h1 class="title">Connect Ledger</h1>
        <p class="subtitle">Store your extension token, choose a default workspace, and save captures into Inbox.</p>
      </div>

      <div class="section">
        <div class="field">
          <label for="token">Extension token</label>
          <div class="inline">
            <input id="token" class="input" type="password" value="${escapeHtml(state.tokenInput)}" placeholder="Paste extension token" />
            <button class="button primary" id="save-token">Save token</button>
          </div>
          <div class="help">Tokens are stored locally in Chrome and sent only as a bearer token to the Ledger API.</div>
        </div>
      </div>

      <div class="section">
        <div class="row">
          <div>
            <div class="label">Default workspace</div>
            <div class="meta">
              <strong>${escapeHtml(state.defaultWorkspaceId ? 'Loaded from Ledger' : 'Automatic')}</strong>
              <div>${escapeHtml(state.defaultWorkspaceId ?? 'Ledger will choose the active workspace when possible.')}</div>
            </div>
          </div>
        </div>
        ${
          state.workspaces.length > 1
            ? `
              <div class="field">
                <label for="workspace">Workspace</label>
                <select id="workspace" class="select">
                  ${workspaceOptions}
                </select>
              </div>
            `
            : ''
        }
        <div class="button-row">
          <button class="button" id="refresh">Refresh workspaces</button>
          <button class="button" id="disconnect">Disconnect</button>
        </div>
      </div>

      <div class="status" data-tone="${state.statusTone}">${escapeHtml(state.statusText)}</div>
    </div>
  `;

  const tokenInput = document.querySelector<HTMLInputElement>('#token');
  const workspaceSelect = document.querySelector<HTMLSelectElement>('#workspace');
  const saveTokenButton = document.querySelector<HTMLButtonElement>('#save-token');
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh');
  const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect');

  tokenInput?.addEventListener('input', () => {
    state.tokenInput = tokenInput.value;
  });

  saveTokenButton?.addEventListener('click', () => {
    void saveToken();
  });

  refreshButton?.addEventListener('click', () => {
    void (async () => {
      setStatus('Refreshing workspaces...', '');
      render();
      await bootstrapWorkspace();
      render();
    })();
  });

  disconnectButton?.addEventListener('click', () => {
    void disconnect();
  });

  workspaceSelect?.addEventListener('change', async () => {
    state.workspaceId = workspaceSelect.value || null;
    await storageSet({ default_workspace_id: state.workspaceId });
    setStatus('Workspace saved.', 'success');
    render();
  });
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

const bootstrap = async () => {
  await loadState();
  if (state.tokenInput) {
    await bootstrapWorkspace();
  }
  render();
};

void bootstrap();
