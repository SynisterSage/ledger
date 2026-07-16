import {
  app,
  BrowserWindow,
  Notification,
  ipcMain,
  screen,
  shell,
  globalShortcut,
  systemPreferences,
  TouchBar,
  Menu,
  Tray,
  nativeImage,
  nativeTheme,
} from 'electron';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { defaultSidebarPreferences, type SidebarPosition } from '../src/config/sidebarPreferences';
import { desktopTokens } from '../src/theme/desktopTokens';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const LEDGER_PROTOCOL = 'ledger';
const SETTINGS_SECTIONS = new Set([
  'account',
  'workspace',
  'calendar',
  'integrations',
  'sidebar',
  'shortcuts',
  'accessibility',
]);

let pendingLedgerProtocolUrl: string | null = null;
let pendingInviteToken: string | null = null;
let sidebarTouchBar: InstanceType<typeof TouchBar> | null = null;
let tray: Tray | null = null;
let isQuittingApp = false;

if (process.platform === 'win32') {
  // Command buffer / GPUControl errors on some Windows drivers can freeze
  // transparent-window video surfaces into gray frames.
  // Force software rendering for stable auth splash + login video playback.
  app.disableHardwareAcceleration();

  // Transparent windows + hardware video surfaces can trigger Skia mailbox errors
  // on some Windows GPU/driver combos. Disabling DirectComposition stabilizes
  // auth video playback without changing macOS behavior.
  app.commandLine.appendSwitch('disable-features', 'DirectComposition');
}

// File-based logging for dock debugging (disabled unless LEDGER_DOCK_DEBUG=1/true)
const logFile = path.join(app.getPath('userData'), 'dock-debug.log');
const dockDebugEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.LEDGER_DOCK_DEBUG ?? '')
    .trim()
    .toLowerCase()
);
const dockLog = (message: string) => {
  if (!dockDebugEnabled) return;
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
  } catch {}
};

const require = createRequire(import.meta.url);

type RuntimeConfigValues = {
  apiUrl: string | null;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
};

const readRuntimeConfigValues = (): RuntimeConfigValues => {
  const runtimeConfigCandidates = [
    process.env.LEDGER_RUNTIME_CONFIG_PATH?.trim(),
    path.join(process.cwd(), 'public', 'runtime-config.js'),
    path.join(process.cwd(), 'runtime-config.js'),
    app.isPackaged ? path.join(app.getAppPath(), 'runtime-config.js') : null,
    app.isPackaged ? path.join(app.getAppPath(), 'public', 'runtime-config.js') : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidatePath of runtimeConfigCandidates) {
    try {
      if (!fs.existsSync(candidatePath)) continue;
      const contents = fs.readFileSync(candidatePath, 'utf8');
      const apiUrlMatch = contents.match(/apiUrl:\s*['"]([^'"]+)['"]/);
      const supabaseUrlMatch = contents.match(/supabaseUrl:\s*['"]([^'"]+)['"]/);
      const supabasePublishableKeyMatch = contents.match(
        /supabasePublishableKey:\s*['"]([^'"]+)['"]/
      );
      const supabaseAnonKeyMatch = contents.match(/supabaseAnonKey:\s*['"]([^'"]+)['"]/);

      return {
        apiUrl: apiUrlMatch?.[1]?.trim() || null,
        supabaseUrl: supabaseUrlMatch?.[1]?.trim() || null,
        supabasePublishableKey:
          supabasePublishableKeyMatch?.[1]?.trim() || supabaseAnonKeyMatch?.[1]?.trim() || null,
      };
    } catch {
      // Best-effort only. Fall back to the next candidate or the default host.
    }
  }

  return {
    apiUrl: null,
    supabaseUrl: null,
    supabasePublishableKey: null,
  };
};

const runtimeConfigValues = readRuntimeConfigValues();
const LEDGER_API_URL =
  process.env.VITE_API_URL?.trim() ||
  runtimeConfigValues.apiUrl ||
  'https://api.ledgerworkspace.com';

const isSettingsSection = (value: string | null | undefined): value is string =>
  SETTINGS_SECTIONS.has(String(value ?? '').toLowerCase());

const extractLedgerProtocolUrl = (argv: string[]) =>
  argv.find((value) =>
    String(value ?? '')
      .toLowerCase()
      .startsWith(`${LEDGER_PROTOCOL}://`)
  ) ?? null;

const registerLedgerProtocol = () => {
  try {
    if (process.platform === 'win32' && process.defaultApp) {
      app.setAsDefaultProtocolClient(LEDGER_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
      return;
    }

    app.setAsDefaultProtocolClient(LEDGER_PROTOCOL);
  } catch (error) {
    console.warn('[electron] Failed to register ledger:// protocol', error);
  }
};

const getNativeWindowBackgroundColor = () =>
  nativeTheme.shouldUseDarkColors ? '#0B1220' : desktopTokens.colors.light.background;

const handleLedgerProtocolUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${LEDGER_PROTOCOL}:`) return;

    const host = parsed.hostname.toLowerCase();
    const pathnameParts = parsed.pathname.split('/').filter(Boolean);
    const sectionCandidate =
      host === 'settings'
        ? pathnameParts[0]
        : pathnameParts[0] === 'settings'
        ? pathnameParts[1]
        : null;
    const section = isSettingsSection(sectionCandidate) ? sectionCandidate : 'integrations';

    const inviteToken =
      host === 'invite'
        ? pathnameParts[0] || parsed.searchParams.get('token')
        : pathnameParts[0] === 'invite'
        ? pathnameParts[1] || parsed.searchParams.get('token')
        : parsed.searchParams.get('token');

    if (host === 'invite' || pathnameParts[0] === 'invite') {
      const token = String(inviteToken ?? '').trim();
      if (!token) return;

      pendingInviteToken = token;
      if (!sidebarWin || sidebarWin.isDestroyed()) {
        createSidebarWindow();
      } else {
        if (!sidebarWin.isVisible()) sidebarWin.show();
        sidebarWin.focus();
        if (!sidebarWin.webContents.isLoading()) {
          sidebarWin.webContents.send('ledger:open-invite', { token });
          pendingInviteToken = null;
        }
      }
      return;
    }

    if (host === 'settings' || pathnameParts[0] === 'settings') {
      if (!sidebarWin || sidebarWin.isDestroyed()) {
        createSidebarWindow();
      } else {
        if (!sidebarWin.isVisible()) sidebarWin.show();
        sidebarWin.focus();
      }
      openModuleWindow('settings', null, null, null, null, null, section);
    }
  } catch (error) {
    console.warn('[electron] Failed to handle ledger protocol URL', error);
  }
};

const processPendingLedgerProtocolUrl = () => {
  if (!pendingLedgerProtocolUrl) return;
  const url = pendingLedgerProtocolUrl;
  pendingLedgerProtocolUrl = null;
  handleLedgerProtocolUrl(url);
};

const processPendingInviteToken = () => {
  if (!pendingInviteToken) return;
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  if (sidebarWin.webContents.isLoading()) return;

  const token = pendingInviteToken;
  pendingInviteToken = null;
  sidebarWin.webContents.send('ledger:open-invite', { token });
};

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  const deepLinkUrl = extractLedgerProtocolUrl(argv);
  if (deepLinkUrl) {
    pendingLedgerProtocolUrl = deepLinkUrl;
    if (app.isReady()) {
      processPendingLedgerProtocolUrl();
    }
    return;
  }

  if (sidebarWin && !sidebarWin.isDestroyed()) {
    if (!sidebarWin.isVisible()) sidebarWin.show();
    sidebarWin.focus();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  pendingLedgerProtocolUrl = url;
  if (app.isReady()) {
    processPendingLedgerProtocolUrl();
  }
});

type Spellchecker = {
  correct: (word: string) => boolean;
  suggest: (word: string) => string[];
};

type SpellcheckAutocorrectResult = {
  title: string;
  content_html: string;
  count: number;
};

const tokenizeText = (input: string) => input.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z]+/g) ?? [];

const preserveCaseReplacement = (source: string, replacement: string) => {
  if (!source) return replacement;
  if (source.toUpperCase() === source) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
};

const getSpellchecker = (() => {
  let promise: Promise<Spellchecker> | null = null;

  return () => {
    if (!promise) {
      promise = new Promise((resolve, reject) => {
        const nspell = require('nspell') as (dictionary: unknown) => Spellchecker;
        const dictionary = require('dictionary-en-us') as (
          callback: (error: Error | null, dictionary?: unknown) => void
        ) => void;

        dictionary((error, loadedDictionary) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(nspell(loadedDictionary));
        });
      });
    }
    return promise;
  };
})();

const correctTextWithSpellchecker = (spellchecker: Spellchecker, input: string) => {
  const tokens = tokenizeText(String(input ?? ''));
  let output = '';
  let count = 0;

  for (const token of tokens) {
    if (!/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token)) {
      output += token;
      continue;
    }

    if (spellchecker.correct(token)) {
      output += token;
      continue;
    }

    const suggestion = spellchecker.suggest(token)[0];
    if (!suggestion) {
      output += token;
      continue;
    }

    count += 1;
    output += preserveCaseReplacement(token, suggestion);
  }

  return { text: output, count };
};

const correctHtmlWithSpellchecker = async (spellchecker: Spellchecker, html: string) => {
  const { parseHTML } = require('linkedom') as {
    parseHTML: (source: string) => {
      document: { body: { innerHTML: string; childNodes: ArrayLike<unknown> } };
    };
  };
  const raw = String(html ?? '');
  if (!raw.trim()) return { html: raw, count: 0 };

  const { document } = parseHTML(`<html><body>${raw}</body></html>`);
  let count = 0;

  const walk = (node: {
    nodeType?: number;
    nodeValue?: string | null;
    childNodes?: ArrayLike<unknown>;
  }) => {
    if (node.nodeType === 3) {
      const original = String(node.nodeValue ?? '');
      const tokens = tokenizeText(original);
      let nextValue = '';

      for (const token of tokens) {
        if (!/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token)) {
          nextValue += token;
          continue;
        }

        if (spellchecker.correct(token)) {
          nextValue += token;
          continue;
        }

        const suggestion = spellchecker.suggest(token)[0];
        if (!suggestion) {
          nextValue += token;
          continue;
        }

        count += 1;
        nextValue += preserveCaseReplacement(token, suggestion);
      }

      node.nodeValue = nextValue;
      return;
    }

    const children = node.childNodes ? Array.from(node.childNodes as ArrayLike<unknown>) : [];
    for (const child of children as Array<{
      nodeType?: number;
      nodeValue?: string | null;
      childNodes?: ArrayLike<unknown>;
    }>) {
      walk(child);
    }
  };

  walk(
    document.body as unknown as {
      nodeType?: number;
      nodeValue?: string | null;
      childNodes?: ArrayLike<unknown>;
    }
  );

  return { html: document.body.innerHTML, count };
};

type DockTargetResult = {
  target: FloatingDockTarget;
  bounds: Rect;
};

type MacDockHelperMessage =
  | { kind: 'response'; requestId: number; target: FloatingDockTarget | null; bounds: Rect | null }
  | { kind: 'bounds'; target: FloatingDockTarget; bounds: Rect }
  | { kind: 'missing'; target: FloatingDockTarget }
  | { kind: 'debug'; message: string }
  | { kind: 'error'; requestId?: number; message: string };

type MacDockHelperRequest = {
  resolve: (value: DockTargetResult | null) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

let macDockHelper: ChildProcessWithoutNullStreams | null = null;
let macDockHelperBuffer = '';
let macDockHelperRequestId = 0;
const macDockHelperRequests = new Map<number, MacDockHelperRequest>();

const macDockHelperScript = `
const modulePath = process.env.LEDGER_NWM_PATH || 'node-window-manager'
const { windowManager } = require(modulePath)
const readline = require('node:readline')
const parentPid = Number(process.env.LEDGER_DOCK_PARENT_PID || 0)

let tracking = null
let trackingTimer = null
let trackingWindow = null
let trackingMisses = 0

const send = (message) => {
  try {
    process.stdout.write(JSON.stringify(message) + '\\n')
  } catch {}
}

const isSidebarRect = (x, y, width, height, sidebar) => {
  if (!sidebar) return false
  return (
    Math.abs(x - Number(sidebar.x)) <= 2 &&
    Math.abs(y - Number(sidebar.y)) <= 2 &&
    Math.abs(width - Number(sidebar.width)) <= 2 &&
    Math.abs(height - Number(sidebar.height)) <= 2
  )
}

try {
  const trusted = typeof windowManager.requestAccessibility === 'function'
    ? windowManager.requestAccessibility()
    : true
  send({ kind: 'debug', message: 'mac helper accessibility trusted=' + trusted })
} catch (error) {
  send({ kind: 'debug', message: 'mac helper accessibility check failed: ' + String(error) })
}

const toInfo = (window, sidebar = null, allowLedgerWindows = false) => {
  try {
    const bounds = window.getBounds && window.getBounds()
    if (!bounds) return null
    const processId = Number(window.processId ?? 0)
    const isLedgerWindow = Boolean(parentPid && processId === parentPid)
    const x = Number(bounds.x)
    const y = Number(bounds.y)
    const width = Number(bounds.width)
    const height = Number(bounds.height)
    if (![x, y, width, height].every(Number.isFinite)) return null
    if (isLedgerWindow && !allowLedgerWindows) return null
    if (isSidebarRect(x, y, width, height, sidebar)) return null
    if (width < 80 || height < 80) return null
    if (typeof window.isVisible === 'function' && !window.isVisible()) return null
    return { id: String(window.id), x, y, width, height, isLedgerWindow }
  } catch {
    return null
  }
}

const getWindowsWithInfo = (sidebar = null, allowLedgerWindows = false) => {
  const out = []
  for (const window of windowManager.getWindows()) {
    const info = toInfo(window, sidebar, allowLedgerWindows)
    if (info) out.push({ window, info })
  }
  return out
}

const findWindowById = (id, allowLedgerWindows = false) => {
  for (const item of getWindowsWithInfo(null, allowLedgerWindows)) {
    if (item.info.id === id) return item.window
  }
  return null
}

const scoreDockTarget = ({ sidebar, threshold, allowLedgerWindows = false }) => {
  const sidebarLeft = Math.floor(sidebar.x)
  const sidebarTop = Math.floor(sidebar.y)
  const sidebarRight = Math.floor(sidebar.x + sidebar.width)
  const sidebarBottom = Math.floor(sidebar.y + sidebar.height)
  const sidebarHeight = Math.floor(sidebar.height)
  const dockThreshold = Math.floor(threshold)
  const minimumOverlap = Math.min(96, Math.max(32, Math.floor(sidebarHeight * 0.18)))
  let bestScore = Infinity
  let best = null

  for (const item of getWindowsWithInfo(sidebar, allowLedgerWindows)) {
    const window = item.info
    const rectLeft = window.x
    const rectTop = window.y
    const rectRight = window.x + window.width
    const rectBottom = window.y + window.height
    const verticalOverlap = Math.max(0, Math.min(sidebarBottom, rectBottom) - Math.max(sidebarTop, rectTop))
    let verticalGap = 0
    if (sidebarBottom < rectTop) verticalGap = rectTop - sidebarBottom
    else if (sidebarTop > rectBottom) verticalGap = sidebarTop - rectBottom
    if (verticalOverlap < minimumOverlap && verticalGap > dockThreshold * 2) continue

    const dockLeftDistance = Math.abs(sidebarRight - rectLeft)
    const dockRightDistance = Math.abs(sidebarLeft - rectRight)
    const side = dockLeftDistance <= dockRightDistance ? 'left' : 'right'
    const edgeDistance = Math.min(dockLeftDistance, dockRightDistance)
    if (edgeDistance > dockThreshold * 2) continue

    const verticalPenalty = verticalOverlap > 0 ? 0 : verticalGap
    const score = edgeDistance + verticalPenalty * 0.5 - verticalOverlap * 0.01
    if (score < bestScore) {
      bestScore = score
      best = { window, side }
    }
  }

  return best
}

const findAtEdge = ({ probes, sidebar, allowLedgerWindows = false }) => {
  const windows = getWindowsWithInfo(sidebar, allowLedgerWindows).map((item) => item.info)
  for (const probe of probes) {
    const probeX = Math.floor(probe.x)
    const probeY = Math.floor(probe.y)
    for (const window of windows) {
      const rectRight = window.x + window.width
      const rectBottom = window.y + window.height
      if (probeX >= window.x && probeX <= rectRight && probeY >= window.y && probeY <= rectBottom) {
        return { window, side: probe.side }
      }
    }
  }
  return null
}

const toResponse = (requestId, result) => {
  if (!result) {
    send({ kind: 'response', requestId, target: null, bounds: null })
    return
  }
  send({
    kind: 'response',
    requestId,
    target: {
      platform: 'darwin',
      id: result.window.id,
      side: result.side,
      isLedgerWindow: Boolean(result.window.isLedgerWindow),
    },
    bounds: { x: result.window.x, y: result.window.y, width: result.window.width, height: result.window.height },
  })
}

const stopTracking = () => {
  if (trackingTimer) clearInterval(trackingTimer)
  trackingTimer = null
  tracking = null
  trackingWindow = null
  trackingMisses = 0
}

const startTracking = ({ target, intervalMs }) => {
  stopTracking()
  tracking = target
  trackingWindow = findWindowById(target.id, Boolean(target.isLedgerWindow))
  trackingTimer = setInterval(() => {
    let bounds = null
    try {
      if (!trackingWindow) {
        trackingWindow = findWindowById(target.id, Boolean(target.isLedgerWindow))
      }
      if (trackingWindow && typeof trackingWindow.isVisible === 'function' && !trackingWindow.isVisible()) {
        send({ kind: 'missing', target })
        return
      }
      bounds = trackingWindow && trackingWindow.getBounds ? trackingWindow.getBounds() : null
    } catch {
      bounds = null
    }

    if (!bounds) {
      trackingMisses += 1
      if (trackingMisses % 4 === 0) {
        trackingWindow = findWindowById(target.id, Boolean(target.isLedgerWindow))
      }
      if (trackingMisses > 24) {
        send({ kind: 'missing', target })
      }
      return
    }

    trackingMisses = 0
    const x = Number(bounds.x)
    const y = Number(bounds.y)
    const width = Number(bounds.width)
    const height = Number(bounds.height)
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      send({ kind: 'missing', target })
      return
    }
    send({
      kind: 'bounds',
      target,
      bounds: { x, y, width, height },
    })
  }, Math.max(8, Number(intervalMs) || 16))
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  try {
    const message = JSON.parse(line)
    if (message.kind === 'dockAtCursor') toResponse(message.requestId, scoreDockTarget(message))
    else if (message.kind === 'dockAtEdge') toResponse(message.requestId, findAtEdge(message))
    else if (message.kind === 'track') startTracking(message)
    else if (message.kind === 'stop') stopTracking()
  } catch (error) {
    send({ kind: 'error', message: String(error) })
  }
})

process.on('disconnect', stopTracking)
process.on('SIGTERM', () => {
  stopTracking()
  process.exit(0)
})
`;

process.env.APP_ROOT = path.join(__dirname, '..');
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

type SidebarWindowMode = 'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen';
type SidebarPreferencesPayload = {
  position?: 'right' | 'left' | 'top' | 'bottom' | 'floating';
  opacity?: number;
  blur?: boolean;
  defaultState?: 'expanded' | 'collapsed' | 'remember';
  alwaysOnTop?: boolean;
  shellFullscreen?: boolean;
  autoHide?: boolean;
  isExpanded?: boolean;
  collapsedRestoreIsExpanded?: boolean;
  isHidden?: boolean;
  floatingPosition?: { x: number; y: number };
  floatingDockEnabled?: boolean;
  floatingDockThreshold?: number;
  lastState?: 'expanded' | 'collapsed';
};
type ModuleWindowKind =
  | 'new-tab'
  | 'circle'
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'teams'
  | 'dashboard'
  | 'notifications'
  | 'settings'
  | 'inbox'
  | 'quick-task'
  | 'quick-note'
  | 'quick-event'
  | 'quick-reminder';
type ModuleFocusPayload = {
  kind: ModuleWindowKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};
type WorkspaceModuleRoute = {
  kind: ModuleWindowKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};
type DetachedTabSession = {
  tabId: string;
  workspaceId?: string | null;
  module: ModuleWindowKind;
  route: WorkspaceModuleRoute;
  selectedResourceId?: string | null;
  routeState?: Record<string, unknown>;
  tabHistory: WorkspaceModuleRoute[];
  historyIndex: number;
  title?: string;
  icon?: string;
};
type DetachedWindowRecord = {
  id: string;
  win: BrowserWindow;
  route: WorkspaceModuleRoute;
  backStack: WorkspaceModuleRoute[];
  forwardStack: WorkspaceModuleRoute[];
  recentRoutes: WorkspaceModuleRoute[];
};
type Rect = { x: number; y: number; width: number; height: number };
type DockSide = 'left' | 'right';
type FloatingDockTarget = {
  platform: 'win32' | 'darwin';
  id: string;
  side: DockSide;
  isLedgerWindow?: boolean;
};
type FloatingDockAttachmentStatus =
  | 'attached'
  | 'detached'
  | 'suspended_minimized'
  | 'suspended_fullscreen'
  | 'target_closed';
type WindowsDockTraceInput = {
  trackerType?: string;
  targetId?: string | null;
  targetWindowHandle?: string | null;
  rawTargetBounds?: Rect | null;
  rawTargetBoundsCoordinateSystem?: string;
  normalizedTargetBounds?: Rect | null;
  normalizedTargetBoundsCoordinateSystem?: string;
  reason?: string;
};

let sidebarWin: BrowserWindow | null = null;
const moduleWins = new Map<ModuleWindowKind, BrowserWindow>();
const detachedWindows = new Map<string, DetachedWindowRecord>();
const ledgerWindowIds = new WeakMap<BrowserWindow, string>();
const pendingTabDetaches = new Map<
  string,
  {
    source: BrowserWindow;
    target: BrowserWindow | null;
    session: DetachedTabSession;
    resolve: (success: boolean) => void;
  }
>();
let workspaceModuleWin: BrowserWindow | null = null;
let workspaceModuleKind: ModuleWindowKind | null = null;
let workspaceModuleCurrentRoute: WorkspaceModuleRoute | null = null;
const workspaceModuleBackStack: WorkspaceModuleRoute[] = [];
const workspaceModuleForwardStack: WorkspaceModuleRoute[] = [];
const workspaceModuleRecentRoutes: WorkspaceModuleRoute[] = [];

function getLedgerWindowId(win: BrowserWindow) {
  const existing = ledgerWindowIds.get(win);
  if (existing) return existing;
  const id = `ledger-window-${randomUUID()}`;
  ledgerWindowIds.set(win, id);
  return id;
}

function getDetachedWindowRecord(win: BrowserWindow | null | undefined) {
  if (!win || win.isDestroyed()) return null;
  for (const record of detachedWindows.values()) {
    if (record.win === win) return record;
  }
  return null;
}
let currentSidebarMode: SidebarWindowMode = 'auth';
let currentSidebarPosition: SidebarPosition = 'right';
let currentFloatingPosition = { ...defaultSidebarPreferences.floatingPosition };
let currentSidebarPreferences = { ...defaultSidebarPreferences };
let currentSidebarShellFullscreen = false;
let currentFloatingDockTarget: FloatingDockTarget | null = null;
let currentFloatingDockBounds: Rect | null = null;
let currentFloatingDockAttachmentStatus: FloatingDockAttachmentStatus = 'detached';
let currentFloatingDockMisses = 0;
let currentFloatingDockDisplayId: number | null = null;
let floatingDockHoldUntil = 0;
let floatingDockDragActive = false;
let floatingDockTrackingTimer: NodeJS.Timeout | null = null;
let floatingDockNativeTracker: ChildProcessWithoutNullStreams | null = null;
let floatingDockRefreshInFlight = false;
let workspaceDockRefreshTimer: NodeJS.Timeout | null = null;
let workspaceDockLastRefreshAt = 0;
let workspaceDockRefreshPausedUntil = 0;
let floatingDockNativeBuffer = '';
let windowsNativeDockRequeryAt = 0;
let floatingDragStart: {
  cursor: Electron.Point;
  bounds: Electron.Rectangle;
} | null = null;
let workspaceSidebarMinimizedWithShell = false;
const headerDragStarts = new Map<
  number,
  {
    cursor: Electron.Point;
    bounds: Electron.Rectangle;
    timer: NodeJS.Timeout | null;
    lastPosition: Electron.Point;
    sidebarLastPosition?: Electron.Point;
  }
>();
let sidebarIsVisible = true;
let sidebarAlwaysOnTop = true;
let macAccessibilityPrompted = false;
let lastSidebarToggleAt = 0;
let allLedgerWindowsHidden = false;
let sidebarWasVisibleBeforeHideAll = false;
let sidebarBoundsAnimationTimer: NodeJS.Timeout | null = null;
const trayState = {
  showTrayIcon: true,
  runInBackground: true,
  inboxCount: 0,
  notificationCount: 0,
  notificationsPaused: false,
};
const moduleKindsVisibleBeforeHideAll = new Set<ModuleWindowKind>();
const moduleWindowBoundsMemory = new Map<
  ModuleWindowKind,
  {
    bounds: Electron.Rectangle;
    sidebarPosition: SidebarPosition;
  }
>();
const moduleWindowFullscreenBoundsMemory = new Map<ModuleWindowKind, Electron.Rectangle>();
let workspaceShellFullscreenRestoreBounds: Electron.Rectangle | null = null;

const WINDOW_MARGIN = 16;
const RAIL_SIZE = 64;
const COLLAPSED_SIZE = 64;
const EXPANDED_WIDTH = 320;
const HORIZONTAL_DOCK_WIDTH = 1120;
const HORIZONTAL_DOCK_HEIGHT = 144;
const HORIZONTAL_COLLAPSED_WIDTH = 1120;
const HORIZONTAL_COLLAPSED_HEIGHT = 60;
const FLOATING_EXPANDED_HEIGHT = 760;

function syncCurrentFloatingPosition(bounds?: Electron.Rectangle | null) {
  if (!bounds) {
    if (!sidebarWin || sidebarWin.isDestroyed()) return;
    bounds = sidebarWin.getBounds();
  }

  currentFloatingPosition = {
    x: bounds.x,
    y: bounds.y,
  };

  if (currentSidebarPosition === 'floating') {
    currentFloatingDockDisplayId = getDisplayForBounds(bounds).id;
  }
}

function shouldAttachWorkspaceWindowToSidebar() {
  return (
    currentSidebarPosition === 'floating' &&
    currentSidebarPreferences.floatingDockEnabled !== false &&
    currentSidebarMode !== 'auth' &&
    currentSidebarMode !== 'fullscreen'
  );
}

function getWorkspaceDockTargetId(win: BrowserWindow) {
  return `ledger-workspace:${win.id}`;
}

function isWorkspaceDockTarget(target: FloatingDockTarget | null = currentFloatingDockTarget) {
  return Boolean(target?.isLedgerWindow && String(target.id).startsWith('ledger-workspace:'));
}

function isLedgerWindowDockTarget(target: FloatingDockTarget | null = currentFloatingDockTarget) {
  return Boolean(target?.isLedgerWindow);
}

function getWorkspaceDockTargetBounds() {
  if (!workspaceModuleWin || workspaceModuleWin.isDestroyed()) return null;
  if (workspaceModuleWin.isMinimized()) return null;
  return workspaceModuleWin.getBounds();
}

function setWorkspaceWindowAsFloatingDockTarget(kindOverride?: ModuleWindowKind) {
  if (!shouldAttachWorkspaceWindowToSidebar()) return;
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  if (!workspaceModuleWin || workspaceModuleWin.isDestroyed()) return;

  const targetBounds = getWorkspaceDockTargetBounds();
  if (!targetBounds) return;

  const kind = kindOverride ?? workspaceModuleKind;
  if (!kind || !isWorkspaceModuleKind(kind)) return;

  const side = getDockSide(sidebarWin.getBounds(), targetBounds);
  stopFloatingDockNativeTracker();
  stopMacDockHelperTracking();
  setCurrentFloatingDockTarget(
    {
      platform: process.platform === 'win32' ? 'win32' : 'darwin',
      id: getWorkspaceDockTargetId(workspaceModuleWin),
      side,
      isLedgerWindow: true,
    },
    targetBounds
  );
  applyFloatingDockTargetBounds(targetBounds, side, {
    trackerType: 'ledger-workspace-window',
    targetId: getWorkspaceDockTargetId(workspaceModuleWin),
    targetWindowHandle: getWorkspaceDockTargetId(workspaceModuleWin),
    normalizedTargetBounds: targetBounds,
    normalizedTargetBoundsCoordinateSystem: 'electron-dip',
    reason: 'workspace_window_attached_to_floating_sidebar',
  });
  cancelWorkspaceDockRefresh();
}

function suspendWorkspaceWindowDockTarget() {
  if (!isLedgerWindowDockTarget()) return;
  stopFloatingDockNativeTracker();
  stopFloatingDockTracking();
  stopMacDockHelperTracking();
  cancelWorkspaceDockRefresh();
  currentFloatingDockAttachmentStatus = 'suspended_minimized';
}

const FLOATING_RAIL_HEIGHT = 520;
const MIN_DOCK_HEIGHT = {
  expanded: 640,
  compact: 480,
  minimized: 480,
} as const;
const DASHBOARD_WIDTH = 1200;
const DASHBOARD_HEIGHT = 760;
const AUTH_WIDTH = 1040;
const AUTH_HEIGHT = 700;
const MODULE_DEFAULT_WIDTH = 1200;
const MODULE_DEFAULT_HEIGHT = 760;
const MODULE_MIN_WIDTH = 960;
const MODULE_MIN_HEIGHT = 660;
const NOTIFICATION_CENTER_WIDTH = 480;
const NOTIFICATION_CENTER_HEIGHT = 680;
const NOTIFICATION_CENTER_MIN_WIDTH = 420;
const NOTIFICATION_CENTER_MIN_HEIGHT = 600;
const QUICK_CAPTURE_WIDTH = 400;
const QUICK_CAPTURE_HEIGHT = 320;
const NOTIFICATION_SCHEDULER_INTERVAL_MS = 60_000;
const NOTIFICATION_PREFS_REFRESH_MS = 5 * 60_000;
const NOTIFICATION_SCHEDULER_REFRESH_MIN_DELAY_MS = 15_000;
const NOTIFICATION_SCHEDULER_429_MIN_BACKOFF_MS = 30_000;
const NOTIFICATION_SCHEDULER_429_MAX_BACKOFF_MS = 5 * 60_000;

type NotificationSchedulerItem = {
  id: string;
  sourceType: 'reminder' | 'event' | 'task' | 'project' | 'inbox' | 'workspace_invite';
  sourceId: string;
  notificationType: string;
  title: string | null;
  body: string | null;
  context: string | null;
  workspaceName: string | null;
  workspaceColor: string | null;
  workspaceId?: string | null;
  moduleKind: ModuleWindowKind | null;
  focusPayload: Record<string, unknown> | null;
  actions: Array<'open' | 'dismiss' | 'complete' | 'snooze'>;
  scheduledFor: string;
  status: 'active' | 'earlier';
};

type NotificationPreferencesPayload = {
  desktopEnabled?: boolean;
  inAppEnabled?: boolean;
  paused?: boolean;
};

let notificationSchedulerTimer: NodeJS.Timeout | null = null;
let notificationSchedulerInFlight = false;
let notificationSchedulerCooldownUntil = 0;
let notificationSchedulerLastRunAt = 0;
let notificationScheduler429Streak = 0;
let notificationSchedulerQueuedTimer: NodeJS.Timeout | null = null;
let notificationSchedulerQueuedAt = 0;
let notificationAccessToken: string | null = null;
let notificationApiUrl = LEDGER_API_URL;
let cachedNotificationPreferences: NotificationPreferencesPayload | null = null;
let cachedNotificationPreferencesAt = 0;
const notificationSeenIds = new Set<string>();
let notificationSeenNamespace: string | null = null;
let notificationSessionUserId: string | null = null;
const notificationDeliveryStatePath = path.join(
  app.getPath('userData'),
  'notification-delivery-state.json'
);
const notificationDeliveryState = new Map<string, Record<string, number>>();
let notificationSeenIdsLoadedNamespace: string | null = null;

const getNotificationNamespace = (apiUrl: string | null, userId: string | null) => {
  const normalizedApiUrl = apiUrl?.trim() || '';
  const normalizedUserId = userId?.trim() || '';
  if (!normalizedApiUrl || !normalizedUserId) return null;
  return `${normalizedApiUrl}::${normalizedUserId}`;
};

const loadNotificationDeliveryState = () => {
  try {
    if (!fs.existsSync(notificationDeliveryStatePath)) return;
    const raw = fs.readFileSync(notificationDeliveryStatePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      namespaces?: Record<string, Record<string, number>>;
    } | null;
    const namespaces = parsed?.namespaces;
    if (!namespaces || typeof namespaces !== 'object') return;

    notificationDeliveryState.clear();
    for (const [namespace, value] of Object.entries(namespaces)) {
      if (!namespace || !value || typeof value !== 'object') continue;
      const next: Record<string, number> = {};
      for (const [id, ts] of Object.entries(value)) {
        const time = Number(ts);
        if (!id || !Number.isFinite(time)) continue;
        next[id] = time;
      }
      notificationDeliveryState.set(namespace, next);
    }
  } catch (error) {
    dockLog(`[dock-debug] failed to load notification delivery state: ${String(error)}`);
  }
};

const saveNotificationDeliveryState = () => {
  try {
    const namespaces: Record<string, Record<string, number>> = {};
    for (const [namespace, value] of notificationDeliveryState.entries()) {
      namespaces[namespace] = value;
    }
    fs.writeFileSync(
      notificationDeliveryStatePath,
      JSON.stringify({ version: 1, namespaces }, null, 2),
      'utf8'
    );
  } catch (error) {
    dockLog(`[dock-debug] failed to save notification delivery state: ${String(error)}`);
  }
};

const pruneNotificationDeliveryState = (state: Record<string, number>) => {
  const entries = Object.entries(state).filter(([, ts]) => Number.isFinite(Number(ts)));
  if (entries.length <= 2000) return state;

  const next = Object.fromEntries(
    entries.sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 2000)
  );
  return next;
};

const hydrateNotificationSeenIds = (namespace: string | null) => {
  notificationSeenIds.clear();
  notificationSeenIdsLoadedNamespace = namespace;
  if (!namespace) return;

  const cached = notificationDeliveryState.get(namespace);
  if (!cached) return;

  for (const id of Object.keys(cached)) {
    notificationSeenIds.add(id);
  }
};

const rememberDeliveredNotification = (namespace: string, id: string) => {
  const next = { ...(notificationDeliveryState.get(namespace) ?? {}) };
  next[id] = Date.now();
  notificationDeliveryState.set(namespace, pruneNotificationDeliveryState(next));
  saveNotificationDeliveryState();
};

const getNotificationWindows = () =>
  BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());

const broadcastNotificationSummary = (activeCount: number) => {
  for (const win of getNotificationWindows()) {
    win.webContents.send('ledger:notifications-summary', { activeCount });
  }
};

const broadcastNotificationBatch = (items: NotificationSchedulerItem[]) => {
  for (const win of getNotificationWindows()) {
    win.webContents.send('ledger:notifications-batch', items);
  }
};

const getTrayIconPath = () =>
  path.join(
    process.env.VITE_PUBLIC ?? path.join(process.env.APP_ROOT ?? '', 'public'),
    process.platform === 'win32' ? 'ledger-tray.ico' : 'ledgerTemplate@14.png'
  );

const getDesktopNotificationIconPath = () => {
  const publicRoot = process.env.VITE_PUBLIC ?? path.join(process.env.APP_ROOT ?? '', 'public');
  const preferred =
    process.platform === 'win32'
      ? path.join(publicRoot, 'logo.ico')
      : process.platform === 'darwin'
      ? path.join(publicRoot, 'logo.icns')
      : path.join(publicRoot, 'icon.png');

  if (fs.existsSync(preferred)) {
    return preferred;
  }

  const fallbacks = ['logo.ico', 'logo.icns', 'icon.png', 'logo-color.svg'].map((name) =>
    path.join(publicRoot, name)
  );
  const firstExisting = fallbacks.find((iconPath) => fs.existsSync(iconPath));
  return firstExisting ?? preferred;
};

const getTrayIcon = () => {
  const icon = nativeImage.createFromPath(getTrayIconPath());
  if (process.platform === 'darwin') {
    const resized = icon.resize({ width: 14, height: 14 });
    resized.setTemplateImage(true);
    return resized;
  }
  return icon;
};

const getTrayNotificationLabel = () =>
  trayState.notificationCount > 0
    ? `Open Notifications (${trayState.notificationCount})`
    : 'Open Notifications';

const getTrayInboxLabel = () =>
  trayState.inboxCount > 0 ? `Open Intake (${trayState.inboxCount})` : 'Open Intake';

const syncTray = () => {
  if (!trayState.showTrayIcon) {
    if (tray) {
      tray.destroy();
      tray = null;
    }
    return;
  }

  if (!tray) {
    tray = new Tray(getTrayIcon());
    tray.setToolTip(
      trayState.notificationCount > 0
        ? `Ledger — ${trayState.notificationCount} notification${
            trayState.notificationCount === 1 ? '' : 's'
          }`
        : 'Ledger'
    );
    tray.on('click', () => {
      focusSidebarWindow();
    });
    tray.on('double-click', () => {
      focusSidebarWindow();
    });
    tray.on('right-click', () => {
      tray?.popUpContextMenu();
    });
  } else {
    tray.setImage(getTrayIcon());
    tray.setToolTip(
      trayState.notificationCount > 0
        ? `Ledger — ${trayState.notificationCount} notification${
            trayState.notificationCount === 1 ? '' : 's'
          }`
        : 'Ledger'
    );
  }

  const trayMenu = Menu.buildFromTemplate([
    { label: 'Ledger', enabled: false },
    { type: 'separator' },
    {
      label: 'Open Ledger',
      click: () => focusSidebarWindow(),
    },
    {
      label: 'Quick Capture',
      click: () => openModuleWindow('quick-task'),
    },
    {
      label: getTrayInboxLabel(),
      click: () => openModuleWindow('inbox'),
    },
    {
      label: getTrayNotificationLabel(),
      click: () => openModuleWindow('notifications'),
    },
    {
      label: 'Settings',
      click: () => openModuleWindow('settings'),
    },
    { type: 'separator' },
    {
      label: trayState.notificationsPaused ? 'Resume Notifications' : 'Pause Notifications',
      click: () => {
        void toggleNotificationsPaused();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Ledger',
      click: () => {
        void quitLedgerApp();
      },
    },
  ]);

  tray.setContextMenu(trayMenu);
};

const updateTrayState = (nextState: Partial<typeof trayState>) => {
  Object.assign(trayState, nextState);
  syncTray();
};

const launchNotificationTarget = (item: NotificationSchedulerItem) => {
  const focus = item.focusPayload ?? {};
  const kind = item.moduleKind ?? 'dashboard';

  // If the notification is tied to a workspace, try to set that workspace active first
  (async () => {
    try {
      if (item.workspaceId && notificationAccessToken) {
        await fetchLedgerApi('/api/workspaces/active', notificationAccessToken, {
          method: 'PATCH',
          body: JSON.stringify({ workspace_id: item.workspaceId }),
        });
        // Notify renderer windows to refresh their workspace state
        for (const win of getNotificationWindows()) {
          try {
            win.webContents.send('ledger:workspaces-changed');
          } catch {
            // ignore per-window send errors
          }
        }
      }
    } catch (err) {
      // ignore workspace switch failures — still attempt to open module
      console.warn('[electron] failed to set active workspace for notification', err);
    } finally {
      openModuleWindow(
        kind,
        typeof focus.focusDate === 'string' ? focus.focusDate : null,
        typeof focus.focusProjectId === 'string' ? focus.focusProjectId : null,
        typeof focus.focusNoteId === 'string' ? focus.focusNoteId : null,
        typeof focus.focusTaskId === 'string' ? focus.focusTaskId : null,
        typeof focus.focusContext === 'string' ? focus.focusContext : null
      );
    }
  })();
};

const getNotificationFallbackTitle = (item: NotificationSchedulerItem) => {
  if (item.title?.trim()) return item.title.trim();

  switch (item.sourceType) {
    case 'reminder':
      return 'Reminder: Due';
    case 'event':
      return 'Event: Starting';
    case 'task':
      return 'Task due';
    case 'project':
      return 'Project deadline';
    case 'inbox':
      return 'Intake item';
    case 'workspace_invite':
      return 'Workspace invite';
    default:
      return 'Ledger notification';
  }
};

const isGenericNotificationTitle = (title: string | null | undefined, sourceType: string) => {
  const normalized = String(title ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;

  if (sourceType === 'reminder') {
    return /^reminder(?:\s*[:\-]\s*due)?$/.test(normalized);
  }
  if (sourceType === 'event') {
    return /^event(?:\s*(?:soon|starting))?$/.test(normalized);
  }
  if (sourceType === 'task') {
    return /^task(?:\s*due)?$/.test(normalized);
  }
  if (sourceType === 'project') {
    return /^project(?:\s*deadline)?$/.test(normalized);
  }
  if (sourceType === 'inbox') {
    return /^inbox(?:\s*capture)?$/.test(normalized);
  }
  if (sourceType === 'workspace_invite') {
    return /^workspace invite$|^invite accepted$/.test(normalized);
  }

  return false;
};

const getNotificationDisplayTitle = (item: NotificationSchedulerItem) => {
  const title = item.title?.trim();
  const context = item.context?.trim();
  const body = item.body?.trim();

  if (item.sourceType === 'reminder') {
    if (title && !isGenericNotificationTitle(title, item.sourceType)) return title;
    if (body && !isGenericNotificationTitle(body, item.sourceType)) return body;
    return context ? `Reminder: ${context}` : getNotificationFallbackTitle(item);
  }

  if (item.sourceType === 'event') {
    if (title && !isGenericNotificationTitle(title, item.sourceType)) return title;
    if (body && !isGenericNotificationTitle(body, item.sourceType)) return body;
    return context ? `Event: ${context}` : getNotificationFallbackTitle(item);
  }

  if (title && !isGenericNotificationTitle(title, item.sourceType)) {
    return title;
  }

  return getNotificationFallbackTitle(item);
};

const getNotificationDisplayBody = (item: NotificationSchedulerItem) => {
  const body = item.body?.trim() || '';
  const context = item.context?.trim() || '';

  if (item.sourceType === 'reminder' || item.sourceType === 'event') {
    return body || context || null;
  }

  return body || context || null;
};

const deliverDesktopNotification = (item: NotificationSchedulerItem) => {
  try {
    if (!Notification.isSupported()) return;
    const iconPath = getDesktopNotificationIconPath();
    const subtitle =
      [item.context?.trim(), item.workspaceName?.trim()].filter(Boolean).join(' · ') || undefined;
    const body = getNotificationDisplayBody(item);
    const notification = new Notification({
      title: getNotificationDisplayTitle(item),
      subtitle,
      body: body || item.workspaceName?.trim() || undefined,
      icon: iconPath,
      silent: true,
    });
    notification.on('click', () => {
      // ensure workspace is switched before launching target
      if (item.workspaceId) {
        try {
          for (const win of getNotificationWindows()) {
            win.webContents.send('ledger:set-active-workspace', { workspaceId: item.workspaceId });
          }
        } catch (e) {
          // ignore
        }
      }
      launchNotificationTarget(item);
    });
    notification.show();
  } catch {
    // Best effort.
  }
};

const fetchLedgerApi = async <T>(
  endpoint: string,
  token: string,
  options: RequestInit = {}
): Promise<T> => {
  const response = await fetch(`${notificationApiUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const requestError = new Error(error.error || `Request failed: ${response.status}`) as Error & {
      status?: number;
      retryAfterMs?: number;
    };
    requestError.status = response.status;
    const retryAfterHeader = response.headers.get('retry-after');
    if (retryAfterHeader) {
      const retryAfterSeconds = Number(retryAfterHeader);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        requestError.retryAfterMs = Math.ceil(retryAfterSeconds * 1000);
      } else {
        const retryAfterDate = Date.parse(retryAfterHeader);
        if (!Number.isNaN(retryAfterDate)) {
          requestError.retryAfterMs = Math.max(0, retryAfterDate - Date.now());
        }
      }
    }
    throw requestError;
  }

  return response.json() as Promise<T>;
};

const shouldRefreshNotificationPreferences = () =>
  !cachedNotificationPreferences ||
  Date.now() - cachedNotificationPreferencesAt > NOTIFICATION_PREFS_REFRESH_MS;

const queueNotificationSchedulerRun = (delayMs = 0) => {
  if (!notificationAccessToken) return;

  const now = Date.now();
  const cooldownDelay = Math.max(0, notificationSchedulerCooldownUntil - now);
  const refreshDelay = Math.max(
    0,
    notificationSchedulerLastRunAt + NOTIFICATION_SCHEDULER_REFRESH_MIN_DELAY_MS - now
  );
  const nextDelay = Math.max(delayMs, cooldownDelay, refreshDelay);
  const targetAt = now + nextDelay;

  if (notificationSchedulerQueuedTimer && notificationSchedulerQueuedAt <= targetAt) {
    return;
  }

  if (notificationSchedulerQueuedTimer) {
    clearTimeout(notificationSchedulerQueuedTimer);
    notificationSchedulerQueuedTimer = null;
  }

  notificationSchedulerQueuedAt = targetAt;
  notificationSchedulerQueuedTimer = setTimeout(() => {
    notificationSchedulerQueuedTimer = null;
    notificationSchedulerQueuedAt = 0;
    void runNotificationScheduler();
  }, nextDelay);
};

const runNotificationScheduler = async () => {
  if (notificationSchedulerInFlight || !notificationAccessToken) return;
  if (Date.now() < notificationSchedulerCooldownUntil) return;
  notificationSchedulerInFlight = true;
  notificationSchedulerLastRunAt = Date.now();

  try {
    if (shouldRefreshNotificationPreferences()) {
      cachedNotificationPreferences = await fetchLedgerApi<NotificationPreferencesPayload>(
        '/api/notifications/preferences',
        notificationAccessToken
      );
      cachedNotificationPreferencesAt = Date.now();
    }

    const prefs = cachedNotificationPreferences ?? {};
    updateTrayState({ notificationsPaused: Boolean(prefs.paused) });
    const shouldDeliverDesktop = Boolean(prefs.desktopEnabled);
    const shouldDeliverInApp = prefs.inAppEnabled !== false;
    const shouldPauseDelivery = Boolean(prefs.paused);

    if (shouldPauseDelivery) {
      const summary = await fetchLedgerApi<{ counts?: { active?: number } }>(
        '/api/notifications/summary',
        notificationAccessToken
      );
      broadcastNotificationSummary(Number(summary?.counts?.active ?? 0));
      return;
    }

    const notifications = await fetchLedgerApi<NotificationSchedulerItem[]>(
      '/api/notifications/check',
      notificationAccessToken,
      { method: 'POST' }
    );
    const summary = await fetchLedgerApi<{ counts?: { active?: number } }>(
      '/api/notifications/summary',
      notificationAccessToken
    );
    const activeItems = Array.isArray(notifications) ? notifications : [];
    if (shouldDeliverInApp || shouldDeliverDesktop) {
      const currentNamespace = getNotificationNamespace(
        notificationApiUrl,
        notificationSessionUserId
      );
      if (currentNamespace && notificationSeenIdsLoadedNamespace !== currentNamespace) {
        hydrateNotificationSeenIds(currentNamespace);
      }
      const batchKeys = new Set<string>();
      const unseenItems = activeItems.filter((item) => {
        if (notificationSeenIds.has(item.id)) return false;
        const batchKey = [item.sourceType, item.sourceId, item.notificationType].join(':');
        if (batchKeys.has(batchKey)) return false;
        batchKeys.add(batchKey);
        return true;
      });
      unseenItems.forEach((item) => {
        notificationSeenIds.add(item.id);
        if (currentNamespace) {
          rememberDeliveredNotification(currentNamespace, item.id);
        }
      });
      if (shouldDeliverInApp) {
        broadcastNotificationBatch(unseenItems);
      }
      if (shouldDeliverDesktop) {
        unseenItems.forEach((item) => deliverDesktopNotification(item));
      }
    }
    broadcastNotificationSummary(Number(summary?.counts?.active ?? 0));
    notificationScheduler429Streak = 0;
  } catch (error) {
    if (
      typeof (error as { status?: number } | null)?.status === 'number' &&
      (error as { status?: number }).status === 429
    ) {
      const retryAfterMs = Number((error as { retryAfterMs?: number } | null)?.retryAfterMs ?? 0);
      notificationScheduler429Streak = Math.min(notificationScheduler429Streak + 1, 6);
      const exponentialBackoffMs = Math.min(
        NOTIFICATION_SCHEDULER_429_MAX_BACKOFF_MS,
        NOTIFICATION_SCHEDULER_429_MIN_BACKOFF_MS * 2 ** (notificationScheduler429Streak - 1)
      );
      const retryAfterBackoffMs =
        retryAfterMs > 0 ? Math.max(retryAfterMs, NOTIFICATION_SCHEDULER_429_MIN_BACKOFF_MS) : 0;
      const nextBackoffMs = Math.min(
        NOTIFICATION_SCHEDULER_429_MAX_BACKOFF_MS,
        Math.max(exponentialBackoffMs, retryAfterBackoffMs)
      );
      notificationSchedulerCooldownUntil = Date.now() + nextBackoffMs;
      console.warn(`[electron] Notification scheduler backed off for ${nextBackoffMs}ms after 429`);
      return;
    }
    notificationScheduler429Streak = 0;
    console.warn('[electron] Notification scheduler failed', error);
  } finally {
    notificationSchedulerInFlight = false;
  }
};

const syncNotificationSession = (
  payload: {
    accessToken?: string | null;
    userId?: string | null;
    apiUrl?: string | null;
  } | null
) => {
  if (payload?.apiUrl?.trim()) notificationApiUrl = payload.apiUrl.trim();
  notificationSessionUserId = payload?.userId?.trim() || null;
  const accessToken = payload?.accessToken ?? null;
  const nextAccessToken = accessToken && accessToken.trim() ? accessToken.trim() : null;
  const nextNamespace = getNotificationNamespace(notificationApiUrl, notificationSessionUserId);
  const sessionChanged = nextNamespace !== notificationSeenNamespace;

  if (sessionChanged) {
    notificationSeenNamespace = nextNamespace;
    hydrateNotificationSeenIds(nextNamespace);
    cachedNotificationPreferences = null;
    cachedNotificationPreferencesAt = 0;
    notificationSchedulerCooldownUntil = 0;
  }
  notificationAccessToken = nextAccessToken;
  if (
    sessionChanged ||
    Date.now() - notificationSchedulerLastRunAt > NOTIFICATION_SCHEDULER_INTERVAL_MS
  ) {
    queueNotificationSchedulerRun(0);
  }
};

const broadcastCalendarItemsUpdated = () => {
  const targets = [sidebarWin, moduleWins.get('calendar'), moduleWins.get('dashboard')];
  for (const win of targets) {
    if (!win || win.isDestroyed()) continue;
    win.webContents.send('calendar:items-updated');
  }
};

const broadcastNotesSmartLinksUpdated = (payload: { noteId?: string | null } | null = null) => {
  const targets = [moduleWins.get('notes')];
  for (const win of targets) {
    if (!win || win.isDestroyed()) continue;
    win.webContents.send('notes:smart-links-updated', payload);
  }
};

function lockWindowZoom(win: BrowserWindow) {
  const { webContents } = win;

  webContents.on('did-finish-load', () => {
    webContents.setZoomFactor(1);
    void webContents.setVisualZoomLevelLimits(1, 1);
  });

  webContents.on('before-input-event', (event, input) => {
    const key = input.key?.toLowerCase() ?? '';
    const hasZoomModifier = input.control || input.meta;
    const isZoomShortcut =
      hasZoomModifier && (key === '+' || key === '=' || key === '-' || key === '_' || key === '0');

    const isZoomWheelGesture = input.type === 'mouseWheel' && hasZoomModifier;

    if (isZoomShortcut || isZoomWheelGesture) {
      event.preventDefault();
      webContents.setZoomFactor(1);
    }
  });
}

function attachWindowsCloseShortcut(win: BrowserWindow) {
  if (process.platform !== 'win32') return;

  win.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key ?? '').toLowerCase();
    const isCtrlW = input.control && key === 'w';
    if (!isCtrlW) return;

    event.preventDefault();
    if (!win.isDestroyed()) {
      win.close();
    }
  });
}

function setWindowButtonVisibility(win: BrowserWindow, visible: boolean) {
  const setter = (
    win as BrowserWindow & {
      setWindowButtonVisibility?: (visible: boolean) => void;
    }
  ).setWindowButtonVisibility;

  if (typeof setter === 'function') {
    setter.call(win, visible);
  }
}

function getWindowChromeOptions() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return {
      frame: false,
      autoHideMenuBar: true,
    };
  }

  return { autoHideMenuBar: true };
}

function getModuleWindowChromeOptions() {
  return {
    frame: false,
    autoHideMenuBar: true,
    ...(process.platform === 'win32'
      ? {
          thickFrame: false,
          hasShadow: false,
        }
      : {}),
  };
}

const buildRoundedWindowShape = (
  width: number,
  height: number,
  radius: number
): Electron.Rectangle[] => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const safeRadius = Math.max(
    0,
    Math.min(Math.round(radius), Math.floor(safeWidth / 2), Math.floor(safeHeight / 2))
  );

  if (safeRadius <= 0) {
    return [{ x: 0, y: 0, width: safeWidth, height: safeHeight }];
  }

  const rects: Electron.Rectangle[] = [];
  let activeRect: Electron.Rectangle | null = null;

  for (let y = 0; y < safeHeight; y += 1) {
    let inset = 0;

    if (y < safeRadius) {
      const dy = safeRadius - y - 0.5;
      inset = Math.ceil(safeRadius - Math.sqrt(Math.max(0, safeRadius * safeRadius - dy * dy)));
    } else if (y >= safeHeight - safeRadius) {
      const dy = y - (safeHeight - safeRadius) + 0.5;
      inset = Math.ceil(safeRadius - Math.sqrt(Math.max(0, safeRadius * safeRadius - dy * dy)));
    }

    const rowWidth = safeWidth - inset * 2;
    if (rowWidth <= 0) continue;

    if (activeRect && activeRect.x === inset && activeRect.width === rowWidth) {
      activeRect.height += 1;
    } else {
      activeRect = { x: inset, y, width: rowWidth, height: 1 };
      rects.push(activeRect);
    }
  }

  return rects.length > 0 ? rects : [{ x: 0, y: 0, width: safeWidth, height: safeHeight }];
};

const applyWindowsModuleWindowShape = (win: BrowserWindow) => {
  if (process.platform !== 'win32' || win.isDestroyed()) return;

  const shapedWindow = win as BrowserWindow & {
    setShape?: (rects: Electron.Rectangle[]) => void;
  };

  if (typeof shapedWindow.setShape !== 'function') return;

  try {
    const bounds = win.getBounds();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const rects = win.isFullScreen()
      ? [{ x: 0, y: 0, width, height }]
      : buildRoundedWindowShape(width, height, desktopTokens.radius.window);

    shapedWindow.setShape(rects);
  } catch (error) {
    console.error('[electron] Failed to apply Windows module window shape:', error);
  }
};

function getDockedBounds(width: number, position: SidebarPosition = currentSidebarPosition) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea;
  const minHeight = Math.min(MIN_DOCK_HEIGHT.expanded, workHeight - WINDOW_MARGIN * 2);
  const maxHeight = workHeight - WINDOW_MARGIN * 2;
  const height = Math.max(minHeight, Math.min(maxHeight, maxHeight));

  if (position === 'top' || position === 'bottom') {
    const targetWidth = Math.min(HORIZONTAL_DOCK_WIDTH, workWidth - WINDOW_MARGIN * 2);
    const targetHeight = Math.min(
      HORIZONTAL_DOCK_HEIGHT,
      Math.max(1, workHeight - WINDOW_MARGIN * 2)
    );
    const width = Math.max(1, targetWidth);
    const height = Math.max(1, targetHeight);
    const dockY = position === 'top' ? y + WINDOW_MARGIN : y + workHeight - height - WINDOW_MARGIN;

    return clampRectToWorkArea(
      {
        x: x + Math.round((workWidth - width) / 2),
        y: dockY,
        width,
        height,
      },
      screen.getPrimaryDisplay().workArea
    );
  }

  if (position === 'left') {
    return {
      x: x + WINDOW_MARGIN,
      y: y + WINDOW_MARGIN,
      width,
      height,
    };
  }

  return {
    x: x + workWidth - width - WINDOW_MARGIN,
    y: y + WINDOW_MARGIN,
    width,
    height,
  };
}

function getCollapsedBounds(size: number, position: SidebarPosition = currentSidebarPosition) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea;
  const safeSize = Math.min(size, workWidth - WINDOW_MARGIN * 2, workHeight - WINDOW_MARGIN * 2);

  if (position === 'top' || position === 'bottom') {
    const width = Math.min(HORIZONTAL_COLLAPSED_WIDTH, workWidth - WINDOW_MARGIN * 2);
    const height = Math.min(HORIZONTAL_COLLAPSED_HEIGHT, workHeight - WINDOW_MARGIN * 2);
    const dockY = position === 'top' ? y + WINDOW_MARGIN : y + workHeight - height - WINDOW_MARGIN;

    return clampRectToWorkArea(
      {
        x: x + Math.round((workWidth - width) / 2),
        y: dockY,
        width,
        height,
      },
      screen.getPrimaryDisplay().workArea
    );
  }

  if (position === 'left') {
    return {
      x: x + WINDOW_MARGIN,
      y: y + WINDOW_MARGIN,
      width: safeSize,
      height: safeSize,
    };
  }

  return {
    x: x + workWidth - safeSize - WINDOW_MARGIN,
    y: y + WINDOW_MARGIN,
    width: safeSize,
    height: safeSize,
  };
}

function getFloatingBounds(mode: SidebarWindowMode) {
  if (currentFloatingDockTarget && currentFloatingDockBounds) {
    return getDockedBoundsForTarget(
      currentFloatingDockBounds,
      currentFloatingDockTarget.side,
      mode
    );
  }

  const anchorBounds = sidebarWin && !sidebarWin.isDestroyed() ? sidebarWin.getBounds() : null;
  const anchorPoint = anchorBounds ?? {
    x: currentFloatingPosition.x,
    y: currentFloatingPosition.y,
    width: 1,
    height: 1,
  };
  const display = getDisplayForBounds(anchorPoint);
  const { width: workWidth, height: workHeight } = display.workArea;
  const maxWidth = workWidth - WINDOW_MARGIN * 2;
  const maxHeight = workHeight - WINDOW_MARGIN * 2;

  const width =
    mode === 'compact'
      ? Math.min(COLLAPSED_SIZE, maxWidth)
      : mode === 'minimized'
      ? Math.min(RAIL_SIZE, maxWidth)
      : Math.min(EXPANDED_WIDTH, maxWidth);

  const height =
    mode === 'compact'
      ? Math.min(FLOATING_RAIL_HEIGHT, maxHeight)
      : mode === 'minimized'
      ? Math.min(FLOATING_RAIL_HEIGHT, maxHeight)
      : Math.min(FLOATING_EXPANDED_HEIGHT, maxHeight);

  const displayForRect = getDisplayForBounds({
    x: anchorPoint.x,
    y: anchorPoint.y,
    width,
    height,
  });

  return clampRectToWorkArea(
    {
      x: anchorPoint.x,
      y: anchorPoint.y,
      width,
      height,
    },
    displayForRect.workArea
  );
}

function getCenteredBounds(width: number, height: number) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea;
  const safeWidth = Math.min(width, workWidth - WINDOW_MARGIN * 2);
  const safeHeight = Math.min(height, workHeight - WINDOW_MARGIN * 2);
  return {
    x: x + Math.floor((workWidth - safeWidth) / 2),
    y: y + Math.floor((workHeight - safeHeight) / 2),
    width: safeWidth,
    height: safeHeight,
  };
}

function getCenteredBoundsForCurrentSidebarDisplay(width: number, height: number) {
  if (!sidebarWin || sidebarWin.isDestroyed()) {
    return getCenteredBounds(width, height);
  }

  const currentBounds = sidebarWin.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const { x, y, width: workWidth, height: workHeight } = display.workArea;
  const safeWidth = Math.min(width, workWidth - WINDOW_MARGIN * 2);
  const safeHeight = Math.min(height, workHeight - WINDOW_MARGIN * 2);

  return {
    x: x + Math.floor((workWidth - safeWidth) / 2),
    y: y + Math.floor((workHeight - safeHeight) / 2),
    width: safeWidth,
    height: safeHeight,
  };
}

function clampRectToWorkArea(rect: Rect, workArea: Electron.Rectangle) {
  const maxX = workArea.x + workArea.width - rect.width;
  const maxY = workArea.y + workArea.height - rect.height;
  return {
    x: Math.max(workArea.x, Math.min(rect.x, maxX)),
    y: Math.max(workArea.y, Math.min(rect.y, maxY)),
    width: rect.width,
    height: rect.height,
  };
}

function clampDockedRectToWorkArea(
  rect: Rect,
  workArea: Electron.Rectangle,
  options: { allowVerticalOverflow?: boolean } = {}
) {
  const maxX = workArea.x + workArea.width - rect.width;
  const maxY = workArea.y + workArea.height - rect.height;
  return {
    x: Math.max(workArea.x, Math.min(rect.x, maxX)),
    y: options.allowVerticalOverflow ? rect.y : Math.max(workArea.y, Math.min(rect.y, maxY)),
    width: rect.width,
    height: rect.height,
  };
}

function getDisplayForBounds(bounds: Rect) {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return screen.getPrimaryDisplay();
  }

  const matchingDisplay = screen.getDisplayMatching({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  });

  if (matchingDisplay && Number.isFinite(matchingDisplay.id)) {
    return matchingDisplay;
  }

  return screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  });
}

function getDisplayMatchingNativeRect(rect: Rect) {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return screen.getPrimaryDisplay();

  let bestDisplay = displays[0];
  let bestOverlap = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const rectCenterX = rect.x + rect.width / 2;
  const rectCenterY = rect.y + rect.height / 2;

  for (const display of displays) {
    const physicalBounds = getDisplayNativeBounds(display);
    const physicalCenterX = physicalBounds.x + physicalBounds.width / 2;
    const physicalCenterY = physicalBounds.y + physicalBounds.height / 2;
    const distance = (physicalCenterX - rectCenterX) ** 2 + (physicalCenterY - rectCenterY) ** 2;

    const overlapWidth = Math.max(
      0,
      Math.min(rect.x + rect.width, physicalBounds.x + physicalBounds.width) -
        Math.max(rect.x, physicalBounds.x)
    );
    const overlapHeight = Math.max(
      0,
      Math.min(rect.y + rect.height, physicalBounds.y + physicalBounds.height) -
        Math.max(rect.y, physicalBounds.y)
    );
    const overlapArea = overlapWidth * overlapHeight;

    if (overlapArea > bestOverlap || (overlapArea === bestOverlap && distance < bestDistance)) {
      bestOverlap = overlapArea;
      bestDistance = distance;
      bestDisplay = display;
    }
  }

  return bestDisplay;
}

function getDisplayNativeBounds(display: Electron.Display) {
  if (process.platform === 'win32') {
    const topLeft = screen.dipToScreenPoint({
      x: display.bounds.x,
      y: display.bounds.y,
    });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
    };
  }

  return {
    x: display.bounds.x * display.scaleFactor,
    y: display.bounds.y * display.scaleFactor,
    width: display.bounds.width * display.scaleFactor,
    height: display.bounds.height * display.scaleFactor,
  };
}

function normalizeWindowsBoundsToDip(rawBounds: Rect) {
  const display = getDisplayMatchingNativeRect(rawBounds);
  const nativeBounds = getDisplayNativeBounds(display);

  // Windows DWM/GetWindowRect data from the native tracker is physical pixels.
  // Electron BrowserWindow/screen placement uses DIP, so convert relative to
  // the matched monitor instead of assuming primary-display scale or x/y >= 0.
  return {
    x: Math.round(display.bounds.x + (rawBounds.x - nativeBounds.x) / display.scaleFactor),
    y: Math.round(display.bounds.y + (rawBounds.y - nativeBounds.y) / display.scaleFactor),
    width: Math.max(1, Math.round(rawBounds.width / display.scaleFactor)),
    height: Math.max(1, Math.round(rawBounds.height / display.scaleFactor)),
  };
}

function nativeRectToDipRect(rect: Rect) {
  if (process.platform === 'win32') {
    return normalizeWindowsBoundsToDip(rect);
  }

  const display = getDisplayMatchingNativeRect(rect);
  const nativeBounds = getDisplayNativeBounds(display);
  return {
    x: Math.round(display.bounds.x + (rect.x - nativeBounds.x) / display.scaleFactor),
    y: Math.round(display.bounds.y + (rect.y - nativeBounds.y) / display.scaleFactor),
    width: Math.max(1, Math.round(rect.width / display.scaleFactor)),
    height: Math.max(1, Math.round(rect.height / display.scaleFactor)),
  };
}

function dipPointToNativePoint(point: Electron.Point) {
  if (process.platform === 'win32') {
    return screen.dipToScreenPoint(point);
  }

  return point;
}

function dipRectToNativeRect(rect: Electron.Rectangle) {
  if (process.platform === 'win32') {
    const display = getDisplayForBounds(rect);
    const topLeft = screen.dipToScreenPoint({ x: rect.x, y: rect.y });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: Math.max(1, Math.round(rect.width * display.scaleFactor)),
      height: Math.max(1, Math.round(rect.height * display.scaleFactor)),
    };
  }

  return rect;
}

function dipDistanceToNativeDistance(distance: number, bounds: Electron.Rectangle) {
  if (process.platform !== 'win32') return distance;
  const display = screen.getDisplayMatching(bounds);
  return Math.max(1, Math.round(distance * display.scaleFactor));
}

function rectForDockTrace(rect: Rect | Electron.Rectangle | null | undefined) {
  if (!rect) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function pointForDockTrace(point: Electron.Point | null | undefined) {
  if (!point) return null;
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

function rectCenterForDockTrace(rect: Rect | null | undefined) {
  if (!rect) return null;
  return pointForDockTrace({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  });
}

function displayForDockTrace(display: Electron.Display | null | undefined) {
  if (!display) return null;
  return {
    id: display.id,
    bounds: rectForDockTrace(display.bounds),
    workArea: rectForDockTrace(display.workArea),
    scaleFactor: display.scaleFactor,
  };
}

function getWindowsDockTrackerType() {
  if (floatingDockNativeTracker) return 'windows-native-tracker';
  if (floatingDockTrackingTimer) return 'windows-edge-poll';
  return 'none';
}

async function queryWindowsDockTargetBounds(targetId: string) {
  if (process.platform !== 'win32') return null;
  if (!/^\d+$/.test(targetId)) return null;

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
  [DllImport("user32.dll")]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }
  public static bool TryGetWindowBounds(IntPtr hwnd, out RECT rect) {
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, System.Runtime.InteropServices.Marshal.SizeOf(typeof(RECT))) == 0) {
      return true;
    }
    return GetWindowRect(hwnd, out rect);
  }
  public static bool IsFullscreenLike(IntPtr hwnd, RECT rect) {
    try {
      if (IsZoomed(hwnd)) return false;
      IntPtr monitor = MonitorFromWindow(hwnd, 2);
      if (monitor == IntPtr.Zero) return false;
      MONITORINFO info = new MONITORINFO();
      info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(monitor, ref info)) return false;
      const int tolerance = 8;
      return
        Math.Abs(rect.Left - info.rcMonitor.Left) <= tolerance &&
        Math.Abs(rect.Top - info.rcMonitor.Top) <= tolerance &&
        Math.Abs((rect.Right - rect.Left) - (info.rcMonitor.Right - info.rcMonitor.Left)) <= tolerance * 2 &&
        Math.Abs((rect.Bottom - rect.Top) - (info.rcMonitor.Bottom - info.rcMonitor.Top)) <= tolerance * 2;
    } catch {
      return false;
    }
  }
}
"@
$hwnd = [IntPtr]${targetId}
if (-not [Win32]::IsWindow($hwnd)) { return }
if ([Win32]::IsIconic($hwnd)) {
  Write-Output "state|minimized"
  return
}
$rect = [Win32+RECT]::new()
if (-not [Win32]::TryGetWindowBounds($hwnd, [ref]$rect)) { return }
if ([Win32]::IsFullscreenLike($hwnd, $rect)) {
  Write-Output "state|fullscreen"
  return
}
Write-Output "bounds|$($rect.Left)|$($rect.Top)|$([Math]::Max(1, $rect.Right - $rect.Left))|$([Math]::Max(1, $rect.Bottom - $rect.Top))"
`;

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 2500 }
    );

    const output = String(stdout).trim();
    if (!output) return null;

    const [kind, a, b, c, d] = output.split('|');
    if (kind === 'state') {
      const state = String(a ?? '').toLowerCase();
      if (state === 'minimized' || state === 'fullscreen') {
        return { kind: 'state' as const, state };
      }
      return null;
    }
    if (kind !== 'bounds') return null;

    const parsed = [a, b, c, d].map((value) => Number(value));
    const bounds = {
      x: parsed[0],
      y: parsed[1],
      width: parsed[2],
      height: parsed[3],
    };
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      return null;
    }

    return { kind: 'bounds' as const, bounds };
  } catch (error) {
    writeWindowsDockTrace('windows-target-requery-error', {
      trackerType: 'windows-native-target-requery',
      targetId,
      error: String(error),
    });
    return null;
  }
}

function writeWindowsDockTrace(event: string, details: Record<string, unknown> = {}) {
  if (process.platform !== 'win32' || !dockDebugEnabled) return;
  try {
    dockLog(
      `[dock-debug] win32-dock-trace ${JSON.stringify({
        event,
        platform: process.platform,
        at: Date.now(),
        ...details,
      })}`
    );
  } catch (error) {
    dockLog(`[dock-debug] win32-dock-trace-error event=${event} error=${String(error)}`);
  }
}

function isFullscreenLikeBounds(rect: Rect) {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return false;
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false;

  const display = screen.getDisplayMatching(rect);
  const { x, y, width, height } = display.bounds;
  const tolerance = 8;
  const matchesDisplayBounds =
    Math.abs(rect.x - x) <= tolerance &&
    Math.abs(rect.y - y) <= tolerance &&
    Math.abs(rect.width - width) <= tolerance * 2 &&
    Math.abs(rect.height - height) <= tolerance * 2;

  if (!matchesDisplayBounds) return false;

  if (process.platform === 'win32') {
    const workAreaDiffersFromDisplay =
      Math.abs(display.workArea.x - display.bounds.x) > tolerance ||
      Math.abs(display.workArea.y - display.bounds.y) > tolerance ||
      Math.abs(display.workArea.width - display.bounds.width) > tolerance * 2 ||
      Math.abs(display.workArea.height - display.bounds.height) > tolerance * 2;

    if (workAreaDiffersFromDisplay) return false;
  }

  return true;
}

function isLikelyMinimizingToDock(nextBounds: Rect, previousBounds: Rect | null) {
  if (!previousBounds) return false;
  if (![nextBounds.x, nextBounds.y, nextBounds.width, nextBounds.height].every(Number.isFinite)) {
    return false;
  }

  const previousArea = Math.max(1, previousBounds.width * previousBounds.height);
  const nextArea = Math.max(1, nextBounds.width * nextBounds.height);
  const widthRatio = nextBounds.width / Math.max(1, previousBounds.width);
  const heightRatio = nextBounds.height / Math.max(1, previousBounds.height);
  const areaRatio = nextArea / previousArea;
  const isShrinking =
    areaRatio < 0.72 ||
    widthRatio < 0.82 ||
    heightRatio < 0.82 ||
    nextBounds.width < 120 ||
    nextBounds.height < 120;

  if (!isShrinking) return false;

  const workArea = screen.getDisplayMatching(previousBounds).workArea;
  const tolerance = 28;
  const nextRight = nextBounds.x + nextBounds.width;
  const nextBottom = nextBounds.y + nextBounds.height;
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  const centerX = nextBounds.x + nextBounds.width / 2;
  const centerY = nextBounds.y + nextBounds.height / 2;
  const isMovingOutsideWorkArea =
    centerX < workArea.x || centerX > workRight || centerY < workArea.y || centerY > workBottom;
  const isNearDockEdge =
    nextBounds.x <= workArea.x + tolerance ||
    nextBounds.y <= workArea.y + tolerance ||
    nextRight >= workRight - tolerance ||
    nextBottom >= workBottom - tolerance;

  return isMovingOutsideWorkArea || isNearDockEdge;
}

function getFullscreenWorkAreaForWindow(win: BrowserWindow) {
  const bounds = win.getBounds();
  return screen.getDisplayMatching(bounds).workArea;
}

function sendModuleFullscreenState(
  kind: ModuleWindowKind,
  win: BrowserWindow,
  isFullscreen: boolean
) {
  try {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('module:fullscreen-state-changed', { kind, isFullscreen });
    }
  } catch {}
}

function setSidebarAboveWorkspaceWindow(enabled: boolean) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  const parent = sidebarWin.getParentWindow();
  const workspaceWin =
    workspaceModuleWin && !workspaceModuleWin.isDestroyed() ? workspaceModuleWin : null;

  if (
    enabled &&
    workspaceWin &&
    currentSidebarMode !== 'auth' &&
    currentSidebarMode !== 'fullscreen'
  ) {
    if (parent !== workspaceWin) {
      sidebarWin.setParentWindow(workspaceWin);
    }
    if (sidebarWin.isVisible()) {
      sidebarWin.moveTop();
    }
    return;
  }

  if (parent) {
    sidebarWin.setParentWindow(null);
    const shouldAlwaysOnTop =
      currentSidebarMode !== 'auth' &&
      currentSidebarMode !== 'fullscreen' &&
      (sidebarAlwaysOnTop || currentSidebarShellFullscreen);
    sidebarWin.setAlwaysOnTop(shouldAlwaysOnTop, 'screen-saver');
  }
}

function syncSidebarWorkspaceFullscreenLayer(kind: ModuleWindowKind, win: BrowserWindow) {
  const isWorkspaceShell = win === workspaceModuleWin && isWorkspaceModuleKind(kind);
  const shouldLayer =
    isWorkspaceShell &&
    (Boolean(workspaceShellFullscreenRestoreBounds) ||
      win.isFullScreen() ||
      isFullscreenLikeBounds(win.getBounds()));
  setSidebarAboveWorkspaceWindow(shouldLayer);
}

function minimizeSidebarWithWorkspaceShell() {
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  if (sidebarWin.isMinimized()) {
    workspaceSidebarMinimizedWithShell = true;
    return;
  }
  workspaceSidebarMinimizedWithShell = true;
  sidebarWin.minimize();
}

function restoreSidebarAfterWorkspaceShellMinimize() {
  if (!workspaceSidebarMinimizedWithShell) return;
  workspaceSidebarMinimizedWithShell = false;
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  if (sidebarWin.isMinimized()) {
    sidebarWin.restore();
  }
}

function restoreModuleWindowBounds(kind: ModuleWindowKind, win: BrowserWindow) {
  const shouldRestoreWorkspaceDock =
    kind === workspaceModuleKind && shouldAttachWorkspaceWindowToSidebar();
  if (shouldRestoreWorkspaceDock) {
    pauseWorkspaceDockRefresh(260);
  }
  const isWorkspaceShell = win === workspaceModuleWin && isWorkspaceModuleKind(kind);
  const restoredBounds = isWorkspaceShell
    ? workspaceShellFullscreenRestoreBounds
    : moduleWindowFullscreenBoundsMemory.get(kind);
  if (isWorkspaceShell) {
    setSidebarAboveWorkspaceWindow(false);
  }
  if (restoredBounds) {
    const workArea = screen.getDisplayMatching(restoredBounds).workArea;
    win.setBounds(clampRectToWorkArea(restoredBounds, workArea), false);
    if (isWorkspaceShell) {
      workspaceShellFullscreenRestoreBounds = null;
    } else {
      moduleWindowFullscreenBoundsMemory.delete(kind);
    }
  }
  win.show();
  win.focus();
  if (shouldRestoreWorkspaceDock) {
    setTimeout(() => {
      if (!workspaceModuleWin || workspaceModuleWin.isDestroyed()) return;
      if (workspaceModuleKind !== kind) return;
      setWorkspaceWindowAsFloatingDockTarget(kind);
      applyWorkspaceDockTargetBounds();
    }, 260);
  }
  sendModuleFullscreenState(kind, win, false);
}

function enterModuleWindowFullscreen(kind: ModuleWindowKind, win: BrowserWindow) {
  const isWorkspaceShell = win === workspaceModuleWin && isWorkspaceModuleKind(kind);
  const isPseudoFullscreen = isWorkspaceShell
    ? Boolean(workspaceShellFullscreenRestoreBounds)
    : moduleWindowFullscreenBoundsMemory.has(kind);
  if (isPseudoFullscreen) {
    syncSidebarWorkspaceFullscreenLayer(kind, win);
    sendModuleFullscreenState(kind, win, true);
    return;
  }
  const shouldAttachSidebar =
    kind === workspaceModuleKind && shouldAttachWorkspaceWindowToSidebar();
  if (shouldAttachSidebar) {
    pauseWorkspaceDockRefresh(260);
  }
  const workArea = getFullscreenWorkAreaForWindow(win);
  if (isWorkspaceShell) {
    workspaceShellFullscreenRestoreBounds = win.getBounds();
  } else {
    moduleWindowFullscreenBoundsMemory.set(kind, win.getBounds());
  }
  const fullscreenBounds = clampRectToWorkArea({ ...workArea }, workArea);
  win.setBounds(fullscreenBounds, false);
  if (shouldAttachSidebar) {
    const sidebarBounds = getSidebarBoundsInsideFullscreenTarget(fullscreenBounds);
    if (sidebarBounds && setSidebarBounds(sidebarBounds, true)) {
      currentFloatingPosition = { x: sidebarBounds.x, y: sidebarBounds.y };
      currentFloatingDockBounds = fullscreenBounds;
    }
  }
  win.show();
  win.focus();
  syncSidebarWorkspaceFullscreenLayer(kind, win);
  sendModuleFullscreenState(kind, win, true);
}

function getDockSide(currentBounds: Rect, targetBounds: Rect): DockSide {
  const leftDistance = getDockIntentDistance(currentBounds, targetBounds, 'left');
  const rightDistance = getDockIntentDistance(currentBounds, targetBounds, 'right');
  return leftDistance <= rightDistance ? 'left' : 'right';
}

function getDockIntentDistance(currentBounds: Rect, targetBounds: Rect, side: DockSide) {
  const currentRight = currentBounds.x + currentBounds.width;
  const targetRight = targetBounds.x + targetBounds.width;

  if (side === 'left') {
    return Math.abs(currentRight - targetBounds.x);
  }

  return Math.abs(currentBounds.x - targetRight);
}

function getHorizontalGapBetweenRects(a: Rect, b: Rect) {
  const aRight = a.x + a.width;
  const bRight = b.x + b.width;
  if (aRight < b.x) return b.x - aRight;
  if (bRight < a.x) return a.x - bRight;
  return 0;
}

function getDockedBoundsForTarget(
  targetBounds: Rect,
  side: DockSide,
  mode: SidebarWindowMode,
  options: { allowVerticalOverflow?: boolean } = {}
) {
  const targetDisplay = getDisplayForBounds(targetBounds);
  const { width: workWidth, height: workHeight } = targetDisplay.workArea;
  const width =
    mode === 'compact'
      ? Math.min(COLLAPSED_SIZE, workWidth - WINDOW_MARGIN * 2)
      : mode === 'minimized'
      ? Math.min(RAIL_SIZE, workWidth - WINDOW_MARGIN * 2)
      : Math.min(EXPANDED_WIDTH, workWidth - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(1, workHeight - WINDOW_MARGIN * 2);
  const baseMinHeight =
    mode === 'compact'
      ? MIN_DOCK_HEIGHT.compact
      : mode === 'minimized'
      ? MIN_DOCK_HEIGHT.minimized
      : MIN_DOCK_HEIGHT.expanded;
  const minHeight = Math.min(baseMinHeight, maxHeight);
  const height = Math.max(minHeight, Math.min(targetBounds.height, maxHeight));
  const x = side === 'left' ? targetBounds.x - width : targetBounds.x + targetBounds.width;
  const y = targetBounds.y;
  return clampDockedRectToWorkArea({ x, y, width, height }, targetDisplay.workArea, options);
}

function getSidebarBoundsInsideFullscreenTarget(targetBounds: Rect): Rect | null {
  if (!sidebarWin || sidebarWin.isDestroyed()) return null;
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return null;

  const currentBounds = sidebarWin.getBounds();
  const targetDisplay = getDisplayForBounds(targetBounds);
  const workArea = targetDisplay.workArea;
  const maxWidth = Math.max(1, workArea.width - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(1, workArea.height - WINDOW_MARGIN * 2);
  const verticalWidth =
    currentSidebarMode === 'compact'
      ? Math.min(COLLAPSED_SIZE, maxWidth)
      : currentSidebarMode === 'minimized'
      ? Math.min(RAIL_SIZE, maxWidth)
      : Math.min(EXPANDED_WIDTH, maxWidth);
  const baseVerticalHeight =
    currentSidebarMode === 'compact'
      ? MIN_DOCK_HEIGHT.compact
      : currentSidebarMode === 'minimized'
      ? MIN_DOCK_HEIGHT.minimized
      : MIN_DOCK_HEIGHT.expanded;
  const verticalHeight = Math.max(
    Math.min(baseVerticalHeight, maxHeight),
    Math.min(targetBounds.height, maxHeight)
  );
  const horizontalWidth = Math.min(
    currentSidebarMode === 'minimized' ? HORIZONTAL_COLLAPSED_WIDTH : HORIZONTAL_DOCK_WIDTH,
    maxWidth
  );
  const horizontalHeight = Math.min(
    currentSidebarMode === 'minimized' ? HORIZONTAL_COLLAPSED_HEIGHT : HORIZONTAL_DOCK_HEIGHT,
    maxHeight
  );

  const placement =
    currentSidebarPosition === 'floating'
      ? currentFloatingDockTarget?.side ?? getDockSide(currentBounds, targetBounds)
      : currentSidebarPosition;

  if (placement === 'top') {
    return {
      x: targetBounds.x + Math.round((targetBounds.width - horizontalWidth) / 2),
      y: targetBounds.y,
      width: horizontalWidth,
      height: horizontalHeight,
    };
  }

  if (placement === 'bottom') {
    return {
      x: targetBounds.x + Math.round((targetBounds.width - horizontalWidth) / 2),
      y: targetBounds.y + targetBounds.height - horizontalHeight,
      width: horizontalWidth,
      height: horizontalHeight,
    };
  }

  const side = placement === 'right' ? 'right' : 'left';
  return {
    x: side === 'right' ? targetBounds.x + targetBounds.width - verticalWidth : targetBounds.x,
    y: targetBounds.y,
    width: verticalWidth,
    height: verticalHeight,
  };
}

function sendFloatingDockChanged(
  isDocked: boolean,
  attachmentStatus: FloatingDockAttachmentStatus = isDocked ? 'attached' : 'detached'
) {
  const payload = getFloatingDockStatePayload(isDocked, attachmentStatus);
  currentFloatingDockAttachmentStatus = attachmentStatus;
  try {
    if (sidebarWin && !sidebarWin.isDestroyed() && !sidebarWin.webContents.isDestroyed()) {
      sidebarWin.webContents.send('sidebar:floating-dock-changed', payload);
    }
  } catch {
    // The window can be torn down between the destroyed check and the send.
  }

  const targets = new Set<BrowserWindow>();
  if (workspaceModuleWin && !workspaceModuleWin.isDestroyed()) {
    targets.add(workspaceModuleWin);
  }
  for (const win of moduleWins.values()) {
    if (!win.isDestroyed()) targets.add(win);
  }
  for (const win of targets) {
    try {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send('sidebar:floating-dock-changed', payload);
      }
    } catch {
      // Module windows can close while a dock update is being broadcast.
    }
  }
}

function getFloatingDockStatePayload(
  isDocked = Boolean(currentFloatingDockTarget && currentFloatingDockBounds),
  attachmentStatus: FloatingDockAttachmentStatus = currentFloatingDockAttachmentStatus
) {
  return {
    isDocked,
    attachmentStatus,
    side: currentFloatingDockTarget?.side ?? null,
  };
}

function setCurrentFloatingDockTarget(target: FloatingDockTarget | null, bounds: Rect | null) {
  currentFloatingDockTarget = target;
  currentFloatingDockBounds = bounds;
  currentFloatingDockMisses = 0;
  currentFloatingDockDisplayId = bounds ? getDisplayForBounds(bounds).id : null;
  sendFloatingDockChanged(Boolean(target && bounds), target && bounds ? 'attached' : 'detached');
}

function holdCurrentFloatingDockTarget(durationMs = 1500) {
  if (!currentFloatingDockTarget || !currentFloatingDockBounds) return;
  floatingDockHoldUntil = Math.max(floatingDockHoldUntil, Date.now() + durationMs);
}

function isFloatingDockHoldActive() {
  return Date.now() < floatingDockHoldUntil;
}

function clearCurrentFloatingDockTarget(
  attachmentStatus: Exclude<FloatingDockAttachmentStatus, 'attached'> = 'detached'
) {
  stopFloatingDockNativeTracker();
  stopMacDockHelperTracking();
  currentFloatingDockTarget = null;
  currentFloatingDockBounds = null;
  currentFloatingDockMisses = 0;
  currentFloatingDockDisplayId = null;
  floatingDockHoldUntil = 0;
  windowsNativeDockRequeryAt = 0;
  sendFloatingDockChanged(false, attachmentStatus);
}

function suspendCurrentFloatingDockTarget(
  attachmentStatus: Exclude<FloatingDockAttachmentStatus, 'attached'> = 'detached'
) {
  clearCurrentFloatingDockTarget(attachmentStatus);
  stopFloatingDockTracking();
}

function stopFloatingDockTracking() {
  if (floatingDockTrackingTimer !== null) {
    clearInterval(floatingDockTrackingTimer);
    floatingDockTrackingTimer = null;
  }
}

function cancelWorkspaceDockRefresh() {
  if (workspaceDockRefreshTimer !== null) {
    clearTimeout(workspaceDockRefreshTimer);
    workspaceDockRefreshTimer = null;
  }
  workspaceDockLastRefreshAt = 0;
}

function pauseWorkspaceDockRefresh(durationMs = 220) {
  workspaceDockRefreshPausedUntil = Math.max(
    workspaceDockRefreshPausedUntil,
    Date.now() + durationMs
  );
  cancelWorkspaceDockRefresh();
}

function applyWorkspaceDockTargetBounds(targetBoundsOverride?: Rect) {
  if (!isLedgerWindowDockTarget()) return;
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  if (!workspaceModuleWin || workspaceModuleWin.isDestroyed()) return;
  if (floatingDockDragActive) return;

  const targetBounds = targetBoundsOverride ?? getWorkspaceDockTargetBounds();
  if (!targetBounds) {
    void refreshFloatingDockTarget();
    return;
  }

  currentFloatingDockBounds = targetBounds;
  currentFloatingDockMisses = 0;
  const isWorkspaceFullscreen =
    Boolean(workspaceShellFullscreenRestoreBounds) ||
    isFullscreenLikeBounds(targetBounds) ||
    workspaceModuleWin.isFullScreen();
  if (isWorkspaceFullscreen) {
    const nextBounds = getSidebarBoundsInsideFullscreenTarget(targetBounds);
    if (!nextBounds || rectsMatch(sidebarWin.getBounds(), nextBounds)) {
      if (workspaceModuleKind) {
        syncSidebarWorkspaceFullscreenLayer(workspaceModuleKind, workspaceModuleWin);
      }
      return;
    }
    if (!setSidebarBounds(nextBounds, false)) return;
    currentFloatingPosition = { x: nextBounds.x, y: nextBounds.y };
    if (workspaceModuleKind) {
      syncSidebarWorkspaceFullscreenLayer(workspaceModuleKind, workspaceModuleWin);
    }
    return;
  }

  const side = currentFloatingDockTarget?.side ?? getDockSide(sidebarWin.getBounds(), targetBounds);
  const nextBounds = getDockedBoundsForTarget(targetBounds, side, currentSidebarMode, {
    allowVerticalOverflow: true,
  });

  if (rectsMatch(sidebarWin.getBounds(), nextBounds)) return;
  if (!setSidebarBounds(nextBounds, false)) return;
  currentFloatingPosition = { x: nextBounds.x, y: nextBounds.y };
}

function scheduleWorkspaceDockRefresh(delayMs = 16) {
  if (!isLedgerWindowDockTarget()) return;
  if (!workspaceModuleWin || workspaceModuleWin.isDestroyed()) return;
  if (floatingDockDragActive) return;

  const now = Date.now();
  if (now < workspaceDockRefreshPausedUntil) {
    if (workspaceDockRefreshTimer !== null) return;
    workspaceDockRefreshTimer = setTimeout(() => {
      workspaceDockRefreshTimer = null;
      workspaceDockLastRefreshAt = Date.now();
      applyWorkspaceDockTargetBounds();
    }, workspaceDockRefreshPausedUntil - now);
    return;
  }

  const elapsed = now - workspaceDockLastRefreshAt;

  if (elapsed >= delayMs && workspaceDockRefreshTimer === null) {
    workspaceDockLastRefreshAt = now;
    applyWorkspaceDockTargetBounds();
    return;
  }

  if (workspaceDockRefreshTimer !== null) return;

  workspaceDockRefreshTimer = setTimeout(() => {
    workspaceDockRefreshTimer = null;
    workspaceDockLastRefreshAt = Date.now();
    applyWorkspaceDockTargetBounds();
  }, Math.max(0, delayMs - elapsed));
}

function stopFloatingDockNativeTracker() {
  if (floatingDockNativeTracker !== null) {
    try {
      floatingDockNativeTracker.kill();
    } catch (err) {
      // ignore if already killed/destroyed
      console.warn('floatingDockNativeTracker.kill() failed:', err);
    }
    floatingDockNativeTracker = null;
  }
  floatingDockNativeBuffer = '';
}

function resolveMacDockHelperRequestsAsMissing() {
  for (const request of macDockHelperRequests.values()) {
    clearTimeout(request.timeout);
    request.resolve(null);
  }
  macDockHelperRequests.clear();
}

function requestMacAccessibilityIfNeeded() {
  if (process.platform !== 'darwin') return true;
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted && !macAccessibilityPrompted) {
      macAccessibilityPrompted = true;
      systemPreferences.isTrustedAccessibilityClient(true);
      dockLog('[dock-debug] requested mac accessibility permission');
    }
    return trusted;
  } catch (error) {
    dockLog(`[dock-debug] mac accessibility check failed: ${String(error)}`);
    return true;
  }
}

function handleMacDockHelperMessage(message: MacDockHelperMessage) {
  if (message.kind === 'response') {
    const request = macDockHelperRequests.get(message.requestId);
    if (!request) return;
    clearTimeout(request.timeout);
    macDockHelperRequests.delete(message.requestId);
    if (!message.target || !message.bounds) {
      request.resolve(null);
      return;
    }
    request.resolve({ target: message.target, bounds: message.bounds });
    return;
  }

  if (message.kind === 'bounds') {
    if (!currentFloatingDockTarget || currentFloatingDockTarget.id !== message.target.id) return;
    applyFloatingDockTargetBounds(message.bounds, message.target.side);
    return;
  }

  if (message.kind === 'missing') {
    if (!currentFloatingDockTarget || currentFloatingDockTarget.id !== message.target.id) return;
    if (isFloatingDockHoldActive()) {
      currentFloatingDockMisses = 0;
      if (currentFloatingDockBounds) {
        applyFloatingDockTargetBounds(currentFloatingDockBounds, currentFloatingDockTarget.side);
      }
      return;
    }
    currentFloatingDockMisses += 1;
    if (currentFloatingDockMisses > 24) {
      clearCurrentFloatingDockTarget();
      stopFloatingDockTracking();
      applySidebarWindowMode(currentSidebarMode);
    }
    return;
  }

  if (message.kind === 'debug') {
    dockLog(message.message);
    return;
  }

  if (message.kind === 'error') {
    dockLog(`[dock-debug] mac helper error: ${message.message}`);
    if (typeof message.requestId === 'number') {
      const request = macDockHelperRequests.get(message.requestId);
      if (request) {
        clearTimeout(request.timeout);
        macDockHelperRequests.delete(message.requestId);
        request.resolve(null);
      }
    }
  }
}

function ensureMacDockHelper() {
  if (process.platform !== 'darwin') return null;
  if (macDockHelper && !macDockHelper.killed) return macDockHelper;

  requestMacAccessibilityIfNeeded();

  const nodeWindowManagerPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-window-manager')
    : path.join(process.env.APP_ROOT ?? '', 'node_modules', 'node-window-manager');
  const helperCwd = app.isPackaged ? process.resourcesPath : process.env.APP_ROOT;

  const helper = spawn(process.execPath, ['-e', macDockHelperScript], {
    cwd: helperCwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      LEDGER_DOCK_PARENT_PID: String(process.pid),
      LEDGER_NWM_PATH: nodeWindowManagerPath,
      NODE_PATH: app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
        : path.join(process.env.APP_ROOT ?? '', 'node_modules'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  macDockHelper = helper;
  macDockHelperBuffer = '';

  helper.stdout.on('data', (chunk) => {
    macDockHelperBuffer += chunk.toString();
    const lines = macDockHelperBuffer.split(/\r?\n/);
    macDockHelperBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleMacDockHelperMessage(JSON.parse(line) as MacDockHelperMessage);
      } catch (error) {
        dockLog(`[dock-debug] mac helper parse error: ${String(error)}`);
      }
    }
  });

  helper.stderr.on('data', (chunk) => {
    dockLog(`[dock-debug] mac helper stderr: ${chunk.toString().trim()}`);
  });

  helper.stdin.on('error', (error) => {
    dockLog(`[dock-debug] mac helper stdin error: ${String(error)}`);
    if (macDockHelper === helper) {
      macDockHelper = null;
      macDockHelperBuffer = '';
    }
    resolveMacDockHelperRequestsAsMissing();
  });

  helper.on('exit', () => {
    if (macDockHelper === helper) {
      macDockHelper = null;
      macDockHelperBuffer = '';
    }
    resolveMacDockHelperRequestsAsMissing();
    if (currentFloatingDockTarget?.platform === 'darwin') {
      clearCurrentFloatingDockTarget('target_closed');
    }
  });

  helper.on('error', (error) => {
    dockLog(`[dock-debug] mac helper spawn error: ${String(error)}`);
    if (macDockHelper === helper) {
      macDockHelper = null;
      macDockHelperBuffer = '';
    }
    resolveMacDockHelperRequestsAsMissing();
  });

  return helper;
}

function stopMacDockHelperTracking() {
  if (
    !macDockHelper ||
    macDockHelper.killed ||
    macDockHelper.stdin.destroyed ||
    !macDockHelper.stdin.writable
  ) {
    return;
  }
  try {
    macDockHelper.stdin.write(JSON.stringify({ kind: 'stop' }) + '\n', (error) => {
      if (!error) return;
      dockLog(`[dock-debug] mac helper stop write failed: ${String(error)}`);
      if (macDockHelper?.stdin.destroyed) {
        macDockHelper = null;
        macDockHelperBuffer = '';
      }
    });
  } catch (error) {
    dockLog(`[dock-debug] mac helper stop write failed: ${String(error)}`);
  }
}

function stopMacDockHelper() {
  stopMacDockHelperTracking();
  if (macDockHelper && !macDockHelper.killed) {
    try {
      macDockHelper.kill();
    } catch {}
  }
  macDockHelper = null;
  macDockHelperBuffer = '';
  resolveMacDockHelperRequestsAsMissing();
}

function requestMacDockHelper(
  payload: Record<string, unknown>,
  timeoutMs = 700
): Promise<DockTargetResult | null> {
  const helper = ensureMacDockHelper();
  if (!helper || helper.killed || helper.stdin.destroyed || !helper.stdin.writable) {
    return Promise.resolve(null);
  }

  const requestId = ++macDockHelperRequestId;
  const message = { ...payload, requestId };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      macDockHelperRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);

    macDockHelperRequests.set(requestId, { resolve, reject, timeout });

    try {
      helper.stdin.write(JSON.stringify(message) + '\n', (error) => {
        if (!error) return;
        clearTimeout(timeout);
        macDockHelperRequests.delete(requestId);
        resolve(null);
      });
    } catch (error) {
      clearTimeout(timeout);
      macDockHelperRequests.delete(requestId);
      resolve(null);
    }
  });
}

function startMacDockNativeTracker(target: FloatingDockTarget) {
  const helper = ensureMacDockHelper();
  if (!helper || helper.killed) return false;

  try {
    helper.stdin.write(JSON.stringify({ kind: 'track', target, intervalMs: 16 }) + '\n');
    return true;
  } catch {
    return false;
  }
}

function applyFloatingDockTargetBounds(
  targetBounds: Rect,
  side: DockSide,
  trace: WindowsDockTraceInput = {}
) {
  const rawTargetBounds = trace.rawTargetBounds ?? null;
  const normalizedTargetBounds = trace.normalizedTargetBounds ?? targetBounds;
  const targetDisplay = getDisplayForBounds(normalizedTargetBounds);
  const rawTargetDisplay = rawTargetBounds ? getDisplayMatchingNativeRect(rawTargetBounds) : null;
  let currentLedgerBoundsBefore: Electron.Rectangle | null = null;

  const baseTrace = () => ({
    trackerType: trace.trackerType ?? getWindowsDockTrackerType(),
    targetId: trace.targetId ?? currentFloatingDockTarget?.id ?? null,
    targetWindowHandle:
      trace.targetWindowHandle ?? trace.targetId ?? currentFloatingDockTarget?.id ?? null,
    side,
    rawTargetBounds: rectForDockTrace(rawTargetBounds),
    rawTargetBoundsCoordinateSystem:
      trace.rawTargetBoundsCoordinateSystem ??
      (rawTargetBounds ? 'windows-native-physical-pixels' : null),
    rawTargetMatchedDisplay: displayForDockTrace(rawTargetDisplay),
    rawTargetMatchedDisplayNativeBounds: rawTargetDisplay
      ? rectForDockTrace(getDisplayNativeBounds(rawTargetDisplay))
      : null,
    normalizedTargetBounds: rectForDockTrace(normalizedTargetBounds),
    normalizedTargetBoundsCoordinateSystem:
      trace.normalizedTargetBoundsCoordinateSystem ?? 'electron-dip',
    targetBoundsUsedForPlacement: rectForDockTrace(targetBounds),
    targetBoundsUsedForPlacementCoordinateSystem: 'electron-dip',
    targetCenterPoint: rectCenterForDockTrace(normalizedTargetBounds),
    matchedDisplayId: targetDisplay.id,
    matchedDisplay: displayForDockTrace(targetDisplay),
    currentTargetDisplayId: currentFloatingDockDisplayId,
    currentLedgerBoundsBeforePlacement: rectForDockTrace(currentLedgerBoundsBefore),
    traceReason: trace.reason ?? null,
  });

  const writeSkippedTrace = (reason: string, details: Record<string, unknown> = {}) => {
    writeWindowsDockTrace('dock-tick', {
      ...baseTrace(),
      movementSkipped: true,
      skipReason: reason,
      setBoundsCalled: false,
      boundsPassedToSetBounds: null,
      ledgerBoundsImmediatelyAfterSetBounds: sidebarWin?.isDestroyed()
        ? null
        : rectForDockTrace(sidebarWin?.getBounds()),
      ...details,
    });
  };

  if (!sidebarWin || sidebarWin.isDestroyed()) {
    writeSkippedTrace('sidebar_window_missing');
    return;
  }

  currentLedgerBoundsBefore = sidebarWin.getBounds();

  if (currentSidebarPosition !== 'floating') {
    writeSkippedTrace('sidebar_not_floating', { currentSidebarPosition });
    return;
  }

  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') {
    writeSkippedTrace('sidebar_mode_blocks_docking', { currentSidebarMode });
    return;
  }

  if (floatingDockDragActive) {
    writeSkippedTrace('floating_drag_active');
    return;
  }

  if (isFullscreenLikeBounds(targetBounds)) {
    currentFloatingDockBounds = targetBounds;
    currentFloatingDockMisses = 0;
    sendFloatingDockChanged(false, 'suspended_fullscreen');
    writeSkippedTrace('target_fullscreen_like', {
      detachOrSuspendGuardTriggered: 'suspended_fullscreen',
    });
    return;
  }

  if (isLikelyMinimizingToDock(targetBounds, currentFloatingDockBounds)) {
    const currentBounds = sidebarWin.getBounds();
    currentFloatingPosition = { x: currentBounds.x, y: currentBounds.y };
    writeSkippedTrace('target_likely_minimizing', {
      detachOrSuspendGuardTriggered: 'suspended_minimized',
      previousTargetBounds: rectForDockTrace(currentFloatingDockBounds),
    });
    suspendCurrentFloatingDockTarget('suspended_minimized');
    applySidebarWindowMode(currentSidebarMode);
    return;
  }

  currentFloatingDockBounds = targetBounds;
  currentFloatingDockMisses = 0;
  if (currentFloatingDockAttachmentStatus !== 'attached') {
    sendFloatingDockChanged(true, 'attached');
  }

  const previousTargetDisplayId = currentFloatingDockDisplayId;
  const allowCrossDisplayMove =
    process.platform === 'win32' &&
    previousTargetDisplayId !== null &&
    previousTargetDisplayId !== targetDisplay.id;

  if (process.platform === 'win32' && previousTargetDisplayId !== targetDisplay.id) {
    writeWindowsDockTrace('display-handoff', {
      ...baseTrace(),
      previousTargetDisplayId,
      nextTargetDisplayId: targetDisplay.id,
      allowCrossDisplayMove,
      message: 'Windows dock display handoff',
    });
    currentFloatingDockDisplayId = targetDisplay.id;
  }

  const computedBoundsBeforeFinalClamp = getDockedBoundsForTarget(
    targetBounds,
    side,
    currentSidebarMode,
    { allowVerticalOverflow: isWorkspaceDockTarget() }
  );
  const finalClampedBounds = computedBoundsBeforeFinalClamp;
  if (rectsMatch(currentLedgerBoundsBefore, finalClampedBounds)) {
    writeSkippedTrace('already_at_computed_bounds', {
      allowCrossDisplayMove,
      previousTargetDisplayId,
      computedLedgerBoundsBeforeFinalClamp: rectForDockTrace(computedBoundsBeforeFinalClamp),
      finalClampedLedgerBounds: rectForDockTrace(finalClampedBounds),
    });
    return;
  }

  const setBoundsCalled = setSidebarBounds(finalClampedBounds);
  const ledgerBoundsAfterSetBounds =
    sidebarWin && !sidebarWin.isDestroyed() ? sidebarWin.getBounds() : null;

  writeWindowsDockTrace('dock-tick', {
    ...baseTrace(),
    allowCrossDisplayMove,
    previousTargetDisplayId,
    computedLedgerBoundsBeforeFinalClamp: rectForDockTrace(computedBoundsBeforeFinalClamp),
    finalClampedLedgerBounds: rectForDockTrace(finalClampedBounds),
    boundsPassedToSetBounds: rectForDockTrace(finalClampedBounds),
    setBoundsCalled,
    movementSkipped: !setBoundsCalled,
    skipReason: setBoundsCalled ? null : 'set_bounds_failed',
    ledgerBoundsImmediatelyAfterSetBounds: rectForDockTrace(ledgerBoundsAfterSetBounds),
    setBoundsDelta:
      ledgerBoundsAfterSetBounds && setBoundsCalled
        ? {
            x: ledgerBoundsAfterSetBounds.x - finalClampedBounds.x,
            y: ledgerBoundsAfterSetBounds.y - finalClampedBounds.y,
            width: ledgerBoundsAfterSetBounds.width - finalClampedBounds.width,
            height: ledgerBoundsAfterSetBounds.height - finalClampedBounds.height,
          }
        : null,
  });

  if (!setBoundsCalled) return;
  currentFloatingPosition = { x: finalClampedBounds.x, y: finalClampedBounds.y };
}

function rectsMatch(a: Rect, b: Rect) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function cancelSidebarBoundsAnimation() {
  if (sidebarBoundsAnimationTimer !== null) {
    clearTimeout(sidebarBoundsAnimationTimer);
    sidebarBoundsAnimationTimer = null;
  }
}

function easeOutCubic(t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function animateSidebarBounds(bounds: Rect) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return false;
  cancelSidebarBoundsAnimation();

  const startBounds = sidebarWin.getBounds();
  if (rectsMatch(startBounds, bounds)) return true;

  const durationMs = 140;
  const startAt = Date.now();

  const step = () => {
    if (!sidebarWin || sidebarWin.isDestroyed()) {
      cancelSidebarBoundsAnimation();
      return;
    }

    const elapsed = Date.now() - startAt;
    const progress = easeOutCubic(elapsed / durationMs);
    const nextBounds = {
      x: Math.round(startBounds.x + (bounds.x - startBounds.x) * progress),
      y: Math.round(startBounds.y + (bounds.y - startBounds.y) * progress),
      width: Math.round(startBounds.width + (bounds.width - startBounds.width) * progress),
      height: Math.round(startBounds.height + (bounds.height - startBounds.height) * progress),
    };

    sidebarWin.setBounds(nextBounds, false);

    if (elapsed < durationMs) {
      sidebarBoundsAnimationTimer = setTimeout(step, 16);
      return;
    }

    sidebarBoundsAnimationTimer = null;
    sidebarWin.setBounds(bounds, false);
  };

  step();
  return true;
}

function setSidebarBounds(bounds: Rect, animate = false) {
  try {
    if (!sidebarWin || sidebarWin.isDestroyed()) return false;
    if (!animate) {
      cancelSidebarBoundsAnimation();
      sidebarWin.setBounds(bounds, false);
      return true;
    }

    if (process.platform === 'win32') {
      return animateSidebarBounds(bounds);
    }

    sidebarWin.setBounds(bounds, true);
    return true;
  } catch (error) {
    writeWindowsDockTrace('set-bounds-error', {
      trackerType: getWindowsDockTrackerType(),
      requestedBounds: rectForDockTrace(bounds),
      error: String(error),
    });
    return false;
  }
}

function handleNativeDockTrackerLine(line: string, side: DockSide) {
  const [kind, a, b, c, d] = line.trim().split('|');
  if (kind === 'state') {
    const state = String(a ?? '').toLowerCase();
    writeWindowsDockTrace('native-tracker-state', {
      trackerType: 'windows-native-tracker',
      targetId: currentFloatingDockTarget?.id ?? null,
      targetWindowHandle: currentFloatingDockTarget?.id ?? null,
      side,
      state,
    });
    if (state === 'minimized') {
      suspendCurrentFloatingDockTarget('suspended_minimized');
    } else if (state === 'fullscreen') {
      suspendCurrentFloatingDockTarget('suspended_fullscreen');
    } else if (state === 'closed') {
      clearCurrentFloatingDockTarget('target_closed');
    }
    return;
  }

  const [x, y, width, height] = [a, b, c, d];
  if (kind !== 'bounds') return;
  const parsed = [x, y, width, height].map((value) => Number(value));
  const rawRect = {
    x: parsed[0],
    y: parsed[1],
    width: parsed[2],
    height: parsed[3],
  };
  if (
    ![rawRect.x, rawRect.y, rawRect.width, rawRect.height].every(Number.isFinite) ||
    rawRect.width <= 0 ||
    rawRect.height <= 0
  ) {
    writeWindowsDockTrace('native-tracker-parse-skip', {
      trackerType: 'windows-native-tracker',
      targetId: currentFloatingDockTarget?.id ?? null,
      targetWindowHandle: currentFloatingDockTarget?.id ?? null,
      side,
      rawLine: line.trim(),
      parsed,
      skipReason: 'invalid_or_non_positive_size',
    });
    return;
  }
  const dipRect = nativeRectToDipRect(rawRect);
  applyFloatingDockTargetBounds(
    { x: dipRect.x, y: dipRect.y, width: dipRect.width, height: dipRect.height },
    side,
    {
      trackerType: 'windows-native-tracker',
      targetId: currentFloatingDockTarget?.id ?? null,
      targetWindowHandle: currentFloatingDockTarget?.id ?? null,
      rawTargetBounds: rawRect,
      rawTargetBoundsCoordinateSystem: 'windows-native-physical-pixels',
      normalizedTargetBounds: dipRect,
      normalizedTargetBoundsCoordinateSystem: 'electron-dip',
    }
  );
}

function stopHeaderDragLoop(webContentsId: number) {
  const dragStart = headerDragStarts.get(webContentsId);
  if (!dragStart?.timer) return;
  clearTimeout(dragStart.timer);
  dragStart.timer = null;
}

function applyHeaderDragPosition(webContentsId: number, win: BrowserWindow) {
  const dragStart = headerDragStarts.get(webContentsId);
  if (!dragStart) return;
  if (win.isDestroyed() || win.isFullScreen()) return;

  const cursor = screen.getCursorScreenPoint();
  const nextX = Math.round(dragStart.bounds.x + cursor.x - dragStart.cursor.x);
  const nextY = Math.round(dragStart.bounds.y + cursor.y - dragStart.cursor.y);
  const nextBounds = {
    ...dragStart.bounds,
    x: nextX,
    y: nextY,
  };
  const deltaX = nextX - dragStart.lastPosition.x;
  const deltaY = nextY - dragStart.lastPosition.y;

  win.setPosition(nextX, nextY, false);

  if (
    win === workspaceModuleWin &&
    isLedgerWindowDockTarget() &&
    sidebarWin &&
    !sidebarWin.isDestroyed()
  ) {
    cancelSidebarBoundsAnimation();
    const sidebarLastPosition = dragStart.sidebarLastPosition ?? {
      x: sidebarWin.getBounds().x,
      y: sidebarWin.getBounds().y,
    };
    const nextSidebarPosition = {
      x: sidebarLastPosition.x + deltaX,
      y: sidebarLastPosition.y + deltaY,
    };
    sidebarWin.setPosition(nextSidebarPosition.x, nextSidebarPosition.y, false);
    currentFloatingPosition = {
      x: nextSidebarPosition.x,
      y: nextSidebarPosition.y,
    };
    dragStart.sidebarLastPosition = nextSidebarPosition;
  } else if (win === workspaceModuleWin && isWorkspaceDockTarget()) {
    applyWorkspaceDockTargetBounds(nextBounds);
  }

  dragStart.lastPosition = { x: nextX, y: nextY };
}

function startHeaderDragLoop(webContentsId: number, win: BrowserWindow) {
  stopHeaderDragLoop(webContentsId);

  const tick = () => {
    const dragStart = headerDragStarts.get(webContentsId);
    if (!dragStart) return;
    if (win.isDestroyed() || win.isFullScreen()) {
      headerDragStarts.delete(webContentsId);
      return;
    }

    applyHeaderDragPosition(webContentsId, win);
    dragStart.timer = setTimeout(tick, 8);
  };

  tick();
}

function startFloatingDockNativeTracker(target: FloatingDockTarget) {
  stopFloatingDockNativeTracker();

  if (target.platform === 'darwin') return startMacDockNativeTracker(target);
  if (target.platform !== 'win32') return false;
  if (!/^\d+$/.test(target.id)) return false;

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class LedgerDockTracker {
  private const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
  private const uint EVENT_SYSTEM_MINIMIZESTART = 0x0016;
  private const uint WINEVENT_OUTOFCONTEXT = 0;
  private IntPtr targetHwnd;
  private WinEventDelegate callbackRef;
  private System.Timers.Timer pollTimer;

  public delegate void WinEventDelegate(
    IntPtr hWinEventHook,
    uint eventType,
    IntPtr hwnd,
    int idObject,
    int idChild,
    uint dwEventThread,
    uint dwmsEventTime
  );

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MSG {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int ptX;
    public int ptY;
  }

  [DllImport("user32.dll")]
  private static extern IntPtr SetWinEventHook(
    uint eventMin,
    uint eventMax,
    IntPtr hmodWinEventProc,
    WinEventDelegate lpfnWinEventProc,
    uint idProcess,
    uint idThread,
    uint dwFlags
  );

  [DllImport("user32.dll")]
  private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

  [DllImport("user32.dll")]
  private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

  [DllImport("user32.dll")]
  private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("dwmapi.dll")]
  private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

  [DllImport("user32.dll")]
  private static extern bool IsWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern bool IsZoomed(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

  [DllImport("user32.dll")]
  private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

  [DllImport("user32.dll")]
  private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }

  private bool TryGetWindowBounds(IntPtr hwnd, out RECT rect) {
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(RECT))) == 0) {
      return true;
    }
    return GetWindowRect(hwnd, out rect);
  }

  public void EnableDpiAwareness() {
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4));
    } catch {}
  }

  public void Start(long hwndValue) {
    targetHwnd = new IntPtr(hwndValue);
    callbackRef = Callback;
    pollTimer = new System.Timers.Timer(32);
    pollTimer.AutoReset = true;
    pollTimer.Elapsed += (sender, args) => EmitBounds();
    pollTimer.Start();
    EmitBounds();
    IntPtr hook = SetWinEventHook(
      EVENT_SYSTEM_MINIMIZESTART,
      EVENT_OBJECT_LOCATIONCHANGE,
      IntPtr.Zero,
      callbackRef,
      0,
      0,
      WINEVENT_OUTOFCONTEXT
    );
    MSG msg;
    while (IsWindow(targetHwnd) && GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {}
    try {
      if (pollTimer != null) {
        pollTimer.Stop();
        pollTimer.Dispose();
        pollTimer = null;
      }
    } catch {}
    if (hook != IntPtr.Zero) UnhookWinEvent(hook);
  }

  private void Callback(
    IntPtr hWinEventHook,
    uint eventType,
    IntPtr hwnd,
    int idObject,
    int idChild,
    uint dwEventThread,
    uint dwmsEventTime
  ) {
    if (hwnd != targetHwnd) return;
    if (eventType == EVENT_SYSTEM_MINIMIZESTART) {
      Console.Out.WriteLine("state|minimized");
      Console.Out.Flush();
      return;
    }
    EmitBounds();
  }

  private void EmitBounds() {
    if (IsIconic(targetHwnd)) {
      Console.Out.WriteLine("state|minimized");
      Console.Out.Flush();
      return;
    }

    RECT rect;
    if (!TryGetWindowBounds(targetHwnd, out rect)) return;
    if (IsFullscreenLike(rect)) {
      Console.Out.WriteLine("state|fullscreen");
      Console.Out.Flush();
      return;
    }

    Console.Out.WriteLine("bounds|" + rect.Left + "|" + rect.Top + "|" + (rect.Right - rect.Left) + "|" + (rect.Bottom - rect.Top));
    Console.Out.Flush();
  }

  private bool IsFullscreenLike(RECT rect) {
    try {
      if (IsZoomed(targetHwnd)) return false;
      IntPtr monitor = MonitorFromWindow(targetHwnd, 2);
      if (monitor == IntPtr.Zero) return false;
      MONITORINFO info = new MONITORINFO();
      info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(monitor, ref info)) return false;
      const int tolerance = 8;
      return
        Math.Abs(rect.Left - info.rcMonitor.Left) <= tolerance &&
        Math.Abs(rect.Top - info.rcMonitor.Top) <= tolerance &&
        Math.Abs((rect.Right - rect.Left) - (info.rcMonitor.Right - info.rcMonitor.Left)) <= tolerance * 2 &&
        Math.Abs((rect.Bottom - rect.Top) - (info.rcMonitor.Bottom - info.rcMonitor.Top)) <= tolerance * 2;
    } catch {
      return false;
    }
  }
}
"@
$tracker = [LedgerDockTracker]::new()
$tracker.EnableDpiAwareness()
$tracker.Start([Int64]${target.id})
`;

  const tracker = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      windowsHide: true,
    }
  );
  floatingDockNativeTracker = tracker;

  tracker.stdout.on('data', (chunk) => {
    floatingDockNativeBuffer += chunk.toString();
    const lines = floatingDockNativeBuffer.split(/\r?\n/);
    floatingDockNativeBuffer = lines.pop() ?? '';
    for (const line of lines) {
      handleNativeDockTrackerLine(line, target.side);
    }
  });

  tracker.stderr.on('data', (chunk) => {
    console.warn('[electron] Floating dock tracker:', chunk.toString().trim());
  });

  tracker.on('exit', () => {
    if (floatingDockNativeTracker === tracker) {
      floatingDockNativeTracker = null;
      floatingDockNativeBuffer = '';
    }
    if (
      currentFloatingDockTarget?.platform === 'win32' &&
      currentFloatingDockTarget.id === target.id
    ) {
      dockLog(
        `[dock-debug] Windows native dock tracker exited for ${target.id}; falling back to polling`
      );
      startFloatingDockTracking();
    }
  });

  return true;
}

function startFloatingDockTracking() {
  if (floatingDockTrackingTimer !== null) return;
  const pollIntervalMs = process.platform === 'darwin' ? 16 : 48;
  floatingDockTrackingTimer = setInterval(() => {
    void refreshFloatingDockTarget();
  }, pollIntervalMs);
}

async function getMacAccessibilityDockTargetAtCursor(
  sidebarBounds: Electron.Rectangle,
  threshold: number
): Promise<DockTargetResult | null> {
  return requestMacDockHelper({
    kind: 'dockAtCursor',
    allowLedgerWindows: true,
    sidebar: {
      x: sidebarBounds.x,
      y: sidebarBounds.y,
      width: sidebarBounds.width,
      height: sidebarBounds.height,
    },
    threshold,
  });
}

async function getMacAccessibilityDockTargetAtEdge(probe: {
  side: DockSide;
  x: number;
  y: number;
  allowLedgerWindows?: boolean;
}): Promise<DockTargetResult | null> {
  const sidebarBounds = sidebarWin?.getBounds();
  return requestMacDockHelper({
    kind: 'dockAtEdge',
    probes: [probe],
    allowLedgerWindows: Boolean(probe.allowLedgerWindows),
    sidebar: sidebarBounds
      ? {
          x: sidebarBounds.x,
          y: sidebarBounds.y,
          width: sidebarBounds.width,
          height: sidebarBounds.height,
        }
      : null,
  });
}

async function refreshFloatingDockTarget() {
  if (floatingDockRefreshInFlight) return;
  floatingDockRefreshInFlight = true;
  try {
    if (!sidebarWin || sidebarWin.isDestroyed()) return;
    if (currentSidebarPosition !== 'floating') return;
    if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return;
    if (floatingDockDragActive) return;
    if (!currentSidebarPreferences.floatingDockEnabled) return;
    if (!currentFloatingDockTarget) return;

    if (isWorkspaceDockTarget()) {
      const targetBounds = getWorkspaceDockTargetBounds();
      if (!targetBounds) {
        if (workspaceModuleWin && workspaceModuleWin.isMinimized()) {
          suspendWorkspaceWindowDockTarget();
          return;
        }
        clearCurrentFloatingDockTarget('target_closed');
        stopFloatingDockTracking();
        return;
      }
      currentFloatingDockBounds = targetBounds;
      applyFloatingDockTargetBounds(targetBounds, currentFloatingDockTarget.side, {
        trackerType: 'ledger-workspace-window',
        targetId: currentFloatingDockTarget.id,
        targetWindowHandle: currentFloatingDockTarget.id,
        normalizedTargetBounds: targetBounds,
        normalizedTargetBoundsCoordinateSystem: 'electron-dip',
        reason: 'workspace_window_bounds_refresh',
      });
      return;
    }

    if (
      process.platform === 'win32' &&
      floatingDockNativeTracker &&
      currentFloatingDockTarget.platform === 'win32'
    ) {
      // Let the Windows native tracker stay authoritative, but re-query the target
      // HWND periodically so a stalled event hook does not strand the dock on the
      // primary display when the app moves across monitors.
      if (Date.now() - windowsNativeDockRequeryAt >= 500) {
        windowsNativeDockRequeryAt = Date.now();
        const targetHandleBounds = await queryWindowsDockTargetBounds(currentFloatingDockTarget.id);
        if (targetHandleBounds?.kind === 'state') {
          if (targetHandleBounds.state === 'minimized') {
            writeWindowsDockTrace('refresh-windows-native-requery', {
              trackerType: 'windows-native-target-requery',
              targetId: currentFloatingDockTarget.id,
              targetWindowHandle: currentFloatingDockTarget.id,
              normalizedTargetBounds: currentFloatingDockBounds
                ? rectForDockTrace(currentFloatingDockBounds)
                : null,
              normalizedTargetBoundsCoordinateSystem: 'electron-dip',
              movementSkipped: true,
              skipReason: 'target_minimized',
              detachOrSuspendGuardTriggered: 'suspended_minimized',
            });
            suspendCurrentFloatingDockTarget('suspended_minimized');
          } else {
            writeWindowsDockTrace('refresh-windows-native-requery', {
              trackerType: 'windows-native-target-requery',
              targetId: currentFloatingDockTarget.id,
              targetWindowHandle: currentFloatingDockTarget.id,
              normalizedTargetBounds: currentFloatingDockBounds
                ? rectForDockTrace(currentFloatingDockBounds)
                : null,
              normalizedTargetBoundsCoordinateSystem: 'electron-dip',
              movementSkipped: true,
              skipReason: 'target_fullscreen_like',
              detachOrSuspendGuardTriggered: 'suspended_fullscreen',
            });
            clearCurrentFloatingDockTarget('suspended_fullscreen');
          }
          return;
        }

        if (targetHandleBounds?.kind === 'bounds') {
          const normalizedBounds = nativeRectToDipRect(targetHandleBounds.bounds);
          writeWindowsDockTrace('refresh-windows-native-requery', {
            trackerType: 'windows-native-target-requery',
            targetId: currentFloatingDockTarget.id,
            targetWindowHandle: currentFloatingDockTarget.id,
            rawTargetBounds: rectForDockTrace(targetHandleBounds.bounds),
            rawTargetBoundsCoordinateSystem: 'windows-native-physical-pixels',
            normalizedTargetBounds: rectForDockTrace(normalizedBounds),
            normalizedTargetBoundsCoordinateSystem: 'electron-dip',
            targetCenterPoint: rectCenterForDockTrace(normalizedBounds),
            currentLedgerBounds: rectForDockTrace(sidebarWin.getBounds()),
            reason: 'windows_native_tracker_periodic_requery',
          });
          applyFloatingDockTargetBounds(normalizedBounds, currentFloatingDockTarget.side, {
            trackerType: 'windows-native-target-requery',
            targetId: currentFloatingDockTarget.id,
            targetWindowHandle: currentFloatingDockTarget.id,
            rawTargetBounds: targetHandleBounds.bounds,
            rawTargetBoundsCoordinateSystem: 'windows-native-physical-pixels',
            normalizedTargetBounds: normalizedBounds,
            normalizedTargetBoundsCoordinateSystem: 'electron-dip',
            reason: 'windows_native_tracker_periodic_requery',
          });
          return;
        }
      }

      // Let the Windows native tracker drive authoritative target bounds,
      // including multi-display moves.
      if (currentFloatingDockBounds) {
        writeWindowsDockTrace('refresh-skip-edge-probe', {
          trackerType: 'windows-native-tracker',
          targetId: currentFloatingDockTarget.id,
          targetWindowHandle: currentFloatingDockTarget.id,
          normalizedTargetBounds: rectForDockTrace(currentFloatingDockBounds),
          normalizedTargetBoundsCoordinateSystem: 'electron-dip',
          currentLedgerBounds: rectForDockTrace(sidebarWin.getBounds()),
          reason: 'native_tracker_authoritative_edge_probe_skipped',
        });
        applyFloatingDockTargetBounds(currentFloatingDockBounds, currentFloatingDockTarget.side, {
          trackerType: 'windows-native-cache-reapply',
          targetId: currentFloatingDockTarget.id,
          targetWindowHandle: currentFloatingDockTarget.id,
          normalizedTargetBounds: currentFloatingDockBounds,
          normalizedTargetBoundsCoordinateSystem: 'electron-dip',
          reason: 'native_tracker_authoritative_edge_probe_skipped',
        });
      }
      return;
    }

    const sidebarBounds = sidebarWin.getBounds();
    const dockTarget = currentFloatingDockTarget;
    const target = await getFloatingDockTargetAtEdge(
      sidebarBounds,
      dockTarget.side,
      Boolean(dockTarget.isLedgerWindow)
    );

    if (!sidebarWin || sidebarWin.isDestroyed()) return;

    if (!target) {
      if (isFloatingDockHoldActive() && currentFloatingDockTarget && currentFloatingDockBounds) {
        currentFloatingDockMisses = 0;
        applyFloatingDockTargetBounds(currentFloatingDockBounds, currentFloatingDockTarget.side);
        return;
      }
      currentFloatingDockMisses += 1;
      if (currentFloatingDockMisses <= 24 && currentFloatingDockBounds) {
        const fallbackBounds = getDockedBoundsForTarget(
          currentFloatingDockBounds,
          currentFloatingDockTarget.side,
          currentSidebarMode
        );
        if (!sidebarWin || sidebarWin.isDestroyed()) return;
        if (rectsMatch(sidebarWin.getBounds(), fallbackBounds)) return;
        if (!setSidebarBounds(fallbackBounds)) return;
        currentFloatingPosition = { x: fallbackBounds.x, y: fallbackBounds.y };
        writeWindowsDockTrace('edge-poll-fallback', {
          trackerType: getWindowsDockTrackerType(),
          targetId: currentFloatingDockTarget.id,
          targetWindowHandle: currentFloatingDockTarget.id,
          missCount: currentFloatingDockMisses,
          normalizedTargetBounds: rectForDockTrace(currentFloatingDockBounds),
          computedLedgerBoundsBeforeFinalClamp: rectForDockTrace(fallbackBounds),
          finalClampedLedgerBounds: rectForDockTrace(fallbackBounds),
          boundsPassedToSetBounds: rectForDockTrace(fallbackBounds),
          ledgerBoundsImmediatelyAfterSetBounds: rectForDockTrace(sidebarWin.getBounds()),
          reason: 'target_probe_missing_using_last_known_bounds',
        });
        return;
      }
      writeWindowsDockTrace('edge-poll-clear-target', {
        trackerType: getWindowsDockTrackerType(),
        targetId: currentFloatingDockTarget?.id ?? null,
        targetWindowHandle: currentFloatingDockTarget?.id ?? null,
        missCount: currentFloatingDockMisses,
        movementSkipped: true,
        skipReason: 'target_missing_after_probe_misses',
      });
      clearCurrentFloatingDockTarget();
      stopFloatingDockTracking();
      // Reflow to normal floating geometry once dock target is gone.
      applySidebarWindowMode(currentSidebarMode);
      return;
    }

    currentFloatingDockMisses = 0;
    currentFloatingDockTarget = target.target;
    currentFloatingDockBounds = target.bounds;
    if (isFullscreenLikeBounds(target.bounds)) {
      sendFloatingDockChanged(false, 'suspended_fullscreen');
      return;
    }
    if (currentFloatingDockAttachmentStatus !== 'attached') {
      sendFloatingDockChanged(true, 'attached');
    }
    const nextBounds = getDockedBoundsForTarget(
      target.bounds,
      currentFloatingDockTarget.side,
      currentSidebarMode
    );
    if (!sidebarWin || sidebarWin.isDestroyed()) return;
    const currentLedgerBoundsBefore = sidebarWin.getBounds();
    if (rectsMatch(currentLedgerBoundsBefore, nextBounds)) {
      writeWindowsDockTrace('dock-tick', {
        trackerType: getWindowsDockTrackerType(),
        targetId: target.target.id,
        targetWindowHandle: target.target.id,
        side: currentFloatingDockTarget.side,
        normalizedTargetBounds: rectForDockTrace(target.bounds),
        normalizedTargetBoundsCoordinateSystem: 'electron-dip',
        targetCenterPoint: rectCenterForDockTrace(target.bounds),
        matchedDisplayId: getDisplayForBounds(target.bounds).id,
        matchedDisplay: displayForDockTrace(getDisplayForBounds(target.bounds)),
        currentLedgerBoundsBeforePlacement: rectForDockTrace(currentLedgerBoundsBefore),
        computedLedgerBoundsBeforeFinalClamp: rectForDockTrace(nextBounds),
        finalClampedLedgerBounds: rectForDockTrace(nextBounds),
        movementSkipped: true,
        skipReason: 'already_at_computed_bounds',
        setBoundsCalled: false,
      });
      return;
    }
    const setBoundsCalled = setSidebarBounds(nextBounds);
    writeWindowsDockTrace('dock-tick', {
      trackerType: getWindowsDockTrackerType(),
      targetId: target.target.id,
      targetWindowHandle: target.target.id,
      side: currentFloatingDockTarget.side,
      normalizedTargetBounds: rectForDockTrace(target.bounds),
      normalizedTargetBoundsCoordinateSystem: 'electron-dip',
      targetCenterPoint: rectCenterForDockTrace(target.bounds),
      matchedDisplayId: getDisplayForBounds(target.bounds).id,
      matchedDisplay: displayForDockTrace(getDisplayForBounds(target.bounds)),
      currentLedgerBoundsBeforePlacement: rectForDockTrace(currentLedgerBoundsBefore),
      computedLedgerBoundsBeforeFinalClamp: rectForDockTrace(nextBounds),
      finalClampedLedgerBounds: rectForDockTrace(nextBounds),
      boundsPassedToSetBounds: rectForDockTrace(nextBounds),
      setBoundsCalled,
      movementSkipped: !setBoundsCalled,
      skipReason: setBoundsCalled ? null : 'set_bounds_failed',
      ledgerBoundsImmediatelyAfterSetBounds: rectForDockTrace(sidebarWin.getBounds()),
    });
    if (!setBoundsCalled) return;
    currentFloatingPosition = { x: nextBounds.x, y: nextBounds.y };
  } finally {
    floatingDockRefreshInFlight = false;
  }
}

async function getFloatingDockTargetAtCursor(): Promise<DockTargetResult | null> {
  try {
    const sidebarBounds = sidebarWin?.getBounds();
    if (!sidebarBounds) return null;
    const threshold = currentSidebarPreferences.floatingDockThreshold;
    const snapDistance =
      process.platform === 'win32'
        ? Math.max(8, Math.floor(threshold * 2))
        : Math.max(8, Math.floor(threshold * 1.5));

    if (process.platform === 'win32') {
      const nativeSidebarBounds = dipRectToNativeRect(sidebarBounds);
      const nativeSnapDistance = dipDistanceToNativeDistance(snapDistance, sidebarBounds);
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }
  public static bool TryGetWindowBounds(IntPtr hWnd, out RECT rect) {
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, System.Runtime.InteropServices.Marshal.SizeOf(typeof(RECT))) == 0) {
      return true;
    }
    return GetWindowRect(hWnd, out rect);
  }
}
"@
try { [Win32]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
$sidebarLeft = ${Math.floor(nativeSidebarBounds.x)}
$sidebarTop = ${Math.floor(nativeSidebarBounds.y)}
$sidebarRight = ${Math.floor(nativeSidebarBounds.x + nativeSidebarBounds.width)}
$sidebarBottom = ${Math.floor(nativeSidebarBounds.y + nativeSidebarBounds.height)}
$sidebarHeight = ${Math.floor(nativeSidebarBounds.height)}
$parentPid = ${process.pid}
$threshold = ${Math.floor(nativeSnapDistance)}
$script:result = $null
$script:bestScore = [Double]::PositiveInfinity
[Win32]::EnumWindows({
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  if ([Win32]::IsIconic($hWnd)) { return $true }
  $rect = [Win32+RECT]::new()
  if (-not [Win32]::TryGetWindowBounds($hWnd, [ref]$rect)) { return $true }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  $windowProcessId = 0
  [Win32]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId) | Out-Null
  $isLedgerWindow = $windowProcessId -eq $parentPid
  if ($isLedgerWindow) { return $true }
  $sidebarCenterX = $sidebarLeft + (${Math.floor(nativeSidebarBounds.width)} / 2)
  $sidebarCenterY = $sidebarTop + ($sidebarHeight / 2)
  $rectCenterX = $rect.Left + ($width / 2)
  $rectCenterY = $rect.Top + ($height / 2)
  if ([Math]::Abs($rectCenterX - $sidebarCenterX) -le 32 -and [Math]::Abs($rectCenterY - $sidebarCenterY) -le 32 -and [Math]::Abs($width - ${Math.floor(
    nativeSidebarBounds.width
  )}) -le 64 -and [Math]::Abs($height - $sidebarHeight) -le 64) { return $true }
  if ($width -lt 80 -or $height -lt 80) { return $true }

  $overlapTop = [Math]::Max($sidebarTop, $rect.Top)
  $overlapBottom = [Math]::Min($sidebarBottom, $rect.Bottom)
  $verticalOverlap = [Math]::Max(0, $overlapBottom - $overlapTop)
  $verticalGap = 0
  if ($sidebarBottom -lt $rect.Top) { $verticalGap = $rect.Top - $sidebarBottom }
  elseif ($sidebarTop -gt $rect.Bottom) { $verticalGap = $sidebarTop - $rect.Bottom }

  $minimumOverlap = [Math]::Min(96, [Math]::Max(32, [Math]::Floor($sidebarHeight * 0.18)))
  if ($verticalOverlap -lt $minimumOverlap -and $verticalGap -gt $threshold) { return $true }

  $dockLeftDistance = [Math]::Abs($sidebarRight - $rect.Left)
  $dockRightDistance = [Math]::Abs($sidebarLeft - $rect.Right)
  $side = "left"
  $edgeDistance = $dockLeftDistance
  if ($dockRightDistance -lt $dockLeftDistance) {
    $side = "right"
    $edgeDistance = $dockRightDistance
  }
  if ($edgeDistance -gt $threshold) { return $true }

  $verticalPenalty = if ($verticalOverlap -gt 0) { 0 } else { $verticalGap }
  $score = $edgeDistance + ($verticalPenalty * 0.5) - ($verticalOverlap * 0.01)
  if ($score -lt $script:bestScore) {
    $script:bestScore = $score
    $ledgerFlag = if ($isLedgerWindow) { "1" } else { "0" }
    $script:result = "$side|$($hWnd.ToInt64())|$($rect.Left)|$($rect.Top)|$width|$height|$ledgerFlag"
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($script:result) { Write-Output $script:result }
`;
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
          windowsHide: true,
          timeout: 3000,
        }
      );
      const output = String(stdout).trim();
      if (!output) {
        const cursorPoint = screen.getCursorScreenPoint();
        const nativeCursorPoint = dipPointToNativePoint(cursorPoint);
        const cursorScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }
  public static bool TryGetWindowBounds(IntPtr hWnd, out RECT rect) {
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, System.Runtime.InteropServices.Marshal.SizeOf(typeof(RECT))) == 0) {
      return true;
    }
    return GetWindowRect(hWnd, out rect);
  }
}
"@
try { [Win32]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
$sidebarLeft = ${Math.floor(nativeSidebarBounds.x)}
$sidebarTop = ${Math.floor(nativeSidebarBounds.y)}
$sidebarWidth = ${Math.floor(nativeSidebarBounds.width)}
$sidebarHeight = ${Math.floor(nativeSidebarBounds.height)}
$parentPid = ${process.pid}
$cursorPoint = [Win32+POINT]::new()
if ([Win32]::GetCursorPos([ref]$cursorPoint)) {
  $cursorX = $cursorPoint.X
  $cursorY = $cursorPoint.Y
} else {
  $cursorX = ${Math.floor(nativeCursorPoint.x)}
  $cursorY = ${Math.floor(nativeCursorPoint.y)}
}
$script:result = $null
[Win32]::EnumWindows({
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  if ([Win32]::IsIconic($hWnd)) { return $true }
  $rect = [Win32+RECT]::new()
  if (-not [Win32]::TryGetWindowBounds($hWnd, [ref]$rect)) { return $true }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 80 -or $height -lt 80) { return $true }
  $windowProcessId = 0
  [Win32]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId) | Out-Null
  $isLedgerWindow = $windowProcessId -eq $parentPid
  if ($isLedgerWindow) { return $true }
  $sidebarCenterX = $sidebarLeft + ($sidebarWidth / 2)
  $sidebarCenterY = $sidebarTop + ($sidebarHeight / 2)
  $rectCenterX = $rect.Left + ($width / 2)
  $rectCenterY = $rect.Top + ($height / 2)
  if ([Math]::Abs($rectCenterX - $sidebarCenterX) -le 32 -and [Math]::Abs($rectCenterY - $sidebarCenterY) -le 32 -and [Math]::Abs($width - $sidebarWidth) -le 64 -and [Math]::Abs($height - $sidebarHeight) -le 64) { return $true }
  if ($cursorX -ge $rect.Left -and $cursorX -le $rect.Right -and $cursorY -ge $rect.Top -and $cursorY -le $rect.Bottom) {
    $ledgerFlag = if ($isLedgerWindow) { "1" } else { "0" }
    $script:result = "$($hWnd.ToInt64())|$($rect.Left)|$($rect.Top)|$width|$height|$ledgerFlag"
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($script:result) { Write-Output $script:result }
`;
        const { stdout: cursorStdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cursorScript],
          {
            windowsHide: true,
            timeout: 3000,
          }
        );
        const cursorOutput = String(cursorStdout).trim();
        if (cursorOutput) {
          const [id, x, y, width, height, isLedgerWindow] = cursorOutput.split('|');
          const parsed = [x, y, width, height].map((value) => Number(value));
          const rawBounds = {
            x: parsed[0],
            y: parsed[1],
            width: parsed[2],
            height: parsed[3],
          };
          if (
            [rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.height].every(Number.isFinite) &&
            rawBounds.width > 0 &&
            rawBounds.height > 0 &&
            id
          ) {
            const bounds = nativeRectToDipRect(rawBounds);
            const side = getDockSide(sidebarBounds, bounds);
            const display = getDisplayForBounds(bounds);
            const rawDisplay = getDisplayMatchingNativeRect(rawBounds);
            writeWindowsDockTrace('cursor-target-found', {
              trackerType: 'windows-cursor-under-pointer',
              targetId: id,
              targetWindowHandle: id,
              side,
              cursorPoint: pointForDockTrace(cursorPoint),
              nativeCursorPoint: pointForDockTrace(nativeCursorPoint),
              rawTargetBounds: rectForDockTrace(rawBounds),
              rawTargetBoundsCoordinateSystem: 'windows-native-physical-pixels',
              rawTargetMatchedDisplay: displayForDockTrace(rawDisplay),
              rawTargetMatchedDisplayNativeBounds: rectForDockTrace(
                getDisplayNativeBounds(rawDisplay)
              ),
              normalizedTargetBounds: rectForDockTrace(bounds),
              normalizedTargetBoundsCoordinateSystem: 'electron-dip',
              targetCenterPoint: rectCenterForDockTrace(bounds),
              matchedDisplayId: display.id,
              matchedDisplay: displayForDockTrace(display),
            });
            return {
              target: {
                platform: 'win32',
                id,
                side,
                isLedgerWindow: isLedgerWindow === '1',
              },
              bounds,
            };
          }
        }
        writeWindowsDockTrace('cursor-target-scan', {
          trackerType: 'windows-cursor-scan',
          sidebarBounds: rectForDockTrace(sidebarBounds),
          nativeSidebarBounds: rectForDockTrace(nativeSidebarBounds),
          cursorPoint: pointForDockTrace(cursorPoint),
          nativeCursorPoint: pointForDockTrace(nativeCursorPoint),
          snapDistance,
          nativeSnapDistance,
          movementSkipped: true,
          skipReason: 'no_target_window_within_snap_distance',
        });
        return null;
      }
      const [side, id, x, y, width, height, isLedgerWindow] = output.split('|');
      const parsed = [x, y, width, height].map((value) => Number(value));
      const rawBounds = {
        x: parsed[0],
        y: parsed[1],
        width: parsed[2],
        height: parsed[3],
      };
      if (
        ![rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.height].every(Number.isFinite) ||
        rawBounds.width <= 0 ||
        rawBounds.height <= 0 ||
        !id ||
        (side !== 'left' && side !== 'right')
      ) {
        writeWindowsDockTrace('cursor-target-scan', {
          trackerType: 'windows-cursor-scan',
          sidebarBounds: rectForDockTrace(sidebarBounds),
          nativeSidebarBounds: rectForDockTrace(nativeSidebarBounds),
          rawLine: output,
          parsed,
          movementSkipped: true,
          skipReason: 'invalid_target_scan_output',
        });
        return null;
      }
      const bounds = nativeRectToDipRect(rawBounds);
      const display = getDisplayForBounds(bounds);
      const rawDisplay = getDisplayMatchingNativeRect(rawBounds);
      writeWindowsDockTrace('cursor-target-found', {
        trackerType: 'windows-cursor-scan',
        targetId: id,
        targetWindowHandle: id,
        side,
        rawTargetBounds: rectForDockTrace(rawBounds),
        rawTargetBoundsCoordinateSystem: 'windows-native-physical-pixels',
        rawTargetMatchedDisplay: displayForDockTrace(rawDisplay),
        rawTargetMatchedDisplayNativeBounds: rectForDockTrace(getDisplayNativeBounds(rawDisplay)),
        normalizedTargetBounds: rectForDockTrace(bounds),
        normalizedTargetBoundsCoordinateSystem: 'electron-dip',
        targetCenterPoint: rectCenterForDockTrace(bounds),
        matchedDisplayId: display.id,
        matchedDisplay: displayForDockTrace(display),
      });
      return {
        target: {
          platform: 'win32',
          id,
          side,
          isLedgerWindow: isLedgerWindow === '1',
        },
        bounds,
      };
    }

    if (process.platform === 'darwin') {
      return getMacAccessibilityDockTargetAtCursor(sidebarBounds, snapDistance);
    }
  } catch (error) {
    console.warn('[electron] Could not determine foreground app bounds:', error);
  }

  return null;
}

async function getFloatingDockTargetAtEdge(
  sidebarBounds: Electron.Rectangle,
  side: DockSide,
  allowLedgerWindows = false
): Promise<DockTargetResult | null> {
  const centerY = sidebarBounds.y + Math.floor(sidebarBounds.height / 2);
  const xOffsets = [16, 48, 96, 160];
  const yOffsets = [0, -48, 48];
  const probePoints: Array<{ side: DockSide; x: number; y: number }> = [];

  for (const xOffset of xOffsets) {
    for (const yOffset of yOffsets) {
      probePoints.push(
        side === 'left'
          ? {
              side: 'left' as DockSide,
              x: sidebarBounds.x + sidebarBounds.width + xOffset,
              y: centerY + yOffset,
            }
          : {
              side: 'right' as DockSide,
              x: sidebarBounds.x - xOffset,
              y: centerY + yOffset,
            }
      );
    }
  }

  if (process.platform === 'win32') {
    try {
      const nativeSidebarBounds = dipRectToNativeRect(sidebarBounds);
      const sidebarDisplay = getDisplayForBounds(sidebarBounds);
      const nativeOffsetScale = Math.max(1, sidebarDisplay.scaleFactor || 1);
      const nativeCenterY = nativeSidebarBounds.y + Math.floor(nativeSidebarBounds.height / 2);
      const nativeProbePoints = probePoints.map((probe) => {
        const nativeXOffset = Math.max(
          1,
          Math.round(
            Math.abs(
              probe.side === 'left'
                ? probe.x - (sidebarBounds.x + sidebarBounds.width)
                : sidebarBounds.x - probe.x
            ) * nativeOffsetScale
          )
        );
        const nativeYOffset = Math.round((probe.y - centerY) * nativeOffsetScale);

        return {
          ...probe,
          nativeX:
            probe.side === 'left'
              ? nativeSidebarBounds.x + nativeSidebarBounds.width + nativeXOffset
              : nativeSidebarBounds.x - nativeXOffset,
          nativeY: nativeCenterY + nativeYOffset,
        };
      });
      const electronConvertedProbePoints = probePoints.map((probe) => {
        const nativeProbe = dipPointToNativePoint({ x: probe.x, y: probe.y });
        return {
          ...probe,
          nativeX: nativeProbe.x,
          nativeY: nativeProbe.y,
        };
      });
      const allNativeProbePoints = [...nativeProbePoints, ...electronConvertedProbePoints];
      const script = (probeX: number, probeY: number) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  public static bool TryGetWindowBounds(IntPtr hWnd, out RECT rect) {
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, System.Runtime.InteropServices.Marshal.SizeOf(typeof(RECT))) == 0) {
      return true;
    }
    return GetWindowRect(hWnd, out rect);
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }
}
"@
try { [Win32]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
$sidebarLeft = ${Math.floor(nativeSidebarBounds.x)}
$sidebarTop = ${Math.floor(nativeSidebarBounds.y)}
$sidebarWidth = ${Math.floor(nativeSidebarBounds.width)}
$sidebarHeight = ${Math.floor(nativeSidebarBounds.height)}
$parentPid = ${process.pid}
$allowLedgerWindows = ${allowLedgerWindows ? '$true' : '$false'}
$cursor = [Win32+POINT]::new()
$cursor.X = ${Math.floor(probeX)}
$cursor.Y = ${Math.floor(probeY)}
$script:result = $null
[Win32]::EnumWindows({
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  if ([Win32]::IsIconic($hWnd)) { return $true }
  $rect = [Win32+RECT]::new()
  if (-not [Win32]::TryGetWindowBounds($hWnd, [ref]$rect)) { return $true }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  $windowProcessId = 0
  [Win32]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId) | Out-Null
  $isLedgerWindow = $windowProcessId -eq $parentPid
  if ($isLedgerWindow -and -not $allowLedgerWindows) { return $true }
  $sidebarCenterX = $sidebarLeft + ($sidebarWidth / 2)
  $sidebarCenterY = $sidebarTop + ($sidebarHeight / 2)
  $rectCenterX = $rect.Left + ($width / 2)
  $rectCenterY = $rect.Top + ($height / 2)
  if ([Math]::Abs($rectCenterX - $sidebarCenterX) -le 32 -and [Math]::Abs($rectCenterY - $sidebarCenterY) -le 32 -and [Math]::Abs($width - $sidebarWidth) -le 64 -and [Math]::Abs($height - $sidebarHeight) -le 64) { return $true }
  if ($cursor.X -ge $rect.Left -and $cursor.X -le $rect.Right -and $cursor.Y -ge $rect.Top -and $cursor.Y -le $rect.Bottom) {
    $ledgerFlag = if ($isLedgerWindow) { "1" } else { "0" }
    $script:result = "$($hWnd.ToInt64())|$($rect.Left)|$($rect.Top)|$width|$height|$ledgerFlag"
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($script:result) { Write-Output $script:result }
`;
      for (const probe of allNativeProbePoints) {
        const nativeProbe = { x: probe.nativeX, y: probe.nativeY };
        const { stdout } = await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            script(nativeProbe.x, nativeProbe.y),
          ],
          {
            windowsHide: true,
            timeout: 3000,
          }
        );
        const [id, x, y, width, height, isLedgerWindow] = String(stdout).trim().split('|');
        const parsed = [x, y, width, height].map((value) => Number(value));
        const rawBounds = {
          x: parsed[0],
          y: parsed[1],
          width: parsed[2],
          height: parsed[3],
        };
        if (
          ![rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.height].every(Number.isFinite) ||
          rawBounds.width <= 0 ||
          rawBounds.height <= 0 ||
          !id
        ) {
          if (String(stdout).trim()) {
            writeWindowsDockTrace('edge-target-probe-skip', {
              trackerType: 'windows-edge-probe',
              side: probe.side,
              probePoint: pointForDockTrace(probe),
              nativeProbePoint: pointForDockTrace(nativeProbe),
              rawLine: String(stdout).trim(),
              parsed,
              movementSkipped: true,
              skipReason: 'invalid_target_probe_output',
            });
          }
          continue;
        }
        const dipBounds = nativeRectToDipRect(rawBounds);
        const display = getDisplayForBounds(dipBounds);
        const rawDisplay = getDisplayMatchingNativeRect(rawBounds);
        writeWindowsDockTrace('edge-target-found', {
          trackerType: 'windows-edge-probe',
          targetId: id,
          targetWindowHandle: id,
          side: probe.side,
          probePoint: pointForDockTrace(probe),
          nativeProbePoint: pointForDockTrace(nativeProbe),
          rawTargetBounds: rectForDockTrace(rawBounds),
          rawTargetBoundsCoordinateSystem: 'windows-native-physical-pixels',
          rawTargetMatchedDisplay: displayForDockTrace(rawDisplay),
          rawTargetMatchedDisplayNativeBounds: rectForDockTrace(getDisplayNativeBounds(rawDisplay)),
          normalizedTargetBounds: rectForDockTrace(dipBounds),
          normalizedTargetBoundsCoordinateSystem: 'electron-dip',
          targetCenterPoint: rectCenterForDockTrace(dipBounds),
          matchedDisplayId: display.id,
          matchedDisplay: displayForDockTrace(display),
        });
        return {
          target: {
            platform: 'win32',
            id,
            side: probe.side,
            isLedgerWindow: isLedgerWindow === '1',
          },
          bounds: dipBounds,
        };
      }
      writeWindowsDockTrace('edge-target-scan', {
        trackerType: 'windows-edge-probe',
        sidebarBounds: rectForDockTrace(sidebarBounds),
        nativeSidebarBounds: rectForDockTrace(nativeSidebarBounds),
        probeCount: probePoints.length,
        movementSkipped: true,
        skipReason: 'no_target_window_at_probe_points',
      });
    } catch (error) {
      writeWindowsDockTrace('edge-target-scan-error', {
        trackerType: 'windows-edge-probe',
        sidebarBounds: rectForDockTrace(sidebarBounds),
        error: String(error),
        movementSkipped: true,
        skipReason: 'probe_command_failed',
      });
      console.warn('[electron] Could not determine Windows dock target at edge:', error);
    }
    return null;
  }

  if (process.platform === 'darwin') {
    for (const probe of probePoints) {
      const target = await getMacAccessibilityDockTargetAtEdge({
        ...probe,
        allowLedgerWindows,
      });
      if (target) return target;
    }
    return null;
  }

  return null;
}

async function dockFloatingSidebarToTarget() {
  if (!sidebarWin || sidebarWin.isDestroyed()) return null;
  if (currentSidebarPosition !== 'floating') return null;
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return null;
  if (!currentSidebarPreferences.floatingDockEnabled) return null;

  floatingDockDragActive = false;

  // Use the cached dock target if available, otherwise query for a new one
  let target: DockTargetResult | null =
    currentFloatingDockTarget && currentFloatingDockBounds
      ? { target: currentFloatingDockTarget, bounds: currentFloatingDockBounds }
      : null;

  if (!target && process.platform === 'win32') {
    target = await getFloatingDockTargetAtCursor();
  }

  if (!target && process.platform === 'win32') {
    const sidebarBounds = sidebarWin.getBounds();
    target =
      (await getFloatingDockTargetAtEdge(sidebarBounds, 'left', false)) ??
      (await getFloatingDockTargetAtEdge(sidebarBounds, 'right', false));
  }

  if (!target && process.platform !== 'win32') {
    target = await getFloatingDockTargetAtCursor();
  }

  if (!target) {
    writeWindowsDockTrace('manual-dock-skip', {
      trackerType: 'windows-cursor-scan',
      currentLedgerBounds: rectForDockTrace(sidebarWin.getBounds()),
      movementSkipped: true,
      skipReason: 'no_cursor_target',
    });
    clearCurrentFloatingDockTarget();
    stopFloatingDockTracking();
    return null;
  }

  if (isFullscreenLikeBounds(target.bounds)) {
    writeWindowsDockTrace('manual-dock-skip', {
      trackerType: 'windows-cursor-scan',
      targetId: target.target.id,
      targetWindowHandle: target.target.id,
      normalizedTargetBounds: rectForDockTrace(target.bounds),
      normalizedTargetBoundsCoordinateSystem: 'electron-dip',
      movementSkipped: true,
      skipReason: 'target_fullscreen_like',
      detachOrSuspendGuardTriggered: 'suspended_fullscreen',
    });
    clearCurrentFloatingDockTarget('suspended_fullscreen');
    stopFloatingDockTracking();
    return null;
  }

  const currentBounds = sidebarWin.getBounds();
  const threshold = currentSidebarPreferences.floatingDockThreshold;
  const snapDistance =
    process.platform === 'win32'
      ? Math.max(8, Math.floor(threshold * 2))
      : Math.max(8, Math.floor(threshold * 1.5));
  const leftDistance = getDockIntentDistance(currentBounds, target.bounds, 'left');
  const rightDistance = getDockIntentDistance(currentBounds, target.bounds, 'right');
  const horizontalGap = getHorizontalGapBetweenRects(currentBounds, target.bounds);
  const nearestDistance = Math.min(leftDistance, rightDistance);
  if (nearestDistance > snapDistance) {
    writeWindowsDockTrace('manual-dock-skip', {
      trackerType: 'windows-cursor-scan',
      targetId: target.target.id,
      targetWindowHandle: target.target.id,
      normalizedTargetBounds: rectForDockTrace(target.bounds),
      normalizedTargetBoundsCoordinateSystem: 'electron-dip',
      currentLedgerBounds: rectForDockTrace(currentBounds),
      leftDistance,
      rightDistance,
      horizontalGap,
      nearestDistance,
      snapDistance,
      movementSkipped: true,
      skipReason: 'outside_snap_distance',
    });
    clearCurrentFloatingDockTarget();
    stopFloatingDockTracking();
    return null;
  }

  const side =
    target.target.side === 'left' || target.target.side === 'right'
      ? target.target.side
      : getDockSide(currentBounds, target.bounds);
  const isLedgerTarget = Boolean(target.target.isLedgerWindow);
  const dockBounds = getDockedBoundsForTarget(target.bounds, side, currentSidebarMode, {
    allowVerticalOverflow: isLedgerTarget,
  });
  const targetDisplay = getDisplayForBounds(target.bounds);
  const clamped = isLedgerTarget
    ? dockBounds
    : clampRectToWorkArea(dockBounds, targetDisplay.workArea);

  setCurrentFloatingDockTarget({ ...target.target, side }, target.bounds);
  const setBoundsCalled = setSidebarBounds(clamped);
  writeWindowsDockTrace('manual-dock-set-bounds', {
    trackerType: 'windows-cursor-scan',
    targetId: target.target.id,
    targetWindowHandle: target.target.id,
    side,
    normalizedTargetBounds: rectForDockTrace(target.bounds),
    normalizedTargetBoundsCoordinateSystem: 'electron-dip',
    targetCenterPoint: rectCenterForDockTrace(target.bounds),
    matchedDisplayId: targetDisplay.id,
    matchedDisplay: displayForDockTrace(targetDisplay),
    currentLedgerBoundsBeforePlacement: rectForDockTrace(currentBounds),
    computedLedgerBoundsBeforeFinalClamp: rectForDockTrace(dockBounds),
    finalClampedLedgerBounds: rectForDockTrace(clamped),
    boundsPassedToSetBounds: rectForDockTrace(clamped),
    setBoundsCalled,
    movementSkipped: !setBoundsCalled,
    skipReason: setBoundsCalled ? null : 'set_bounds_failed',
    ledgerBoundsImmediatelyAfterSetBounds: rectForDockTrace(sidebarWin.getBounds()),
  });
  if (!setBoundsCalled) return null;
  currentFloatingPosition = { x: clamped.x, y: clamped.y };
  if (isLedgerTarget) {
    stopFloatingDockNativeTracker();
    stopFloatingDockTracking();
    stopMacDockHelperTracking();
    cancelWorkspaceDockRefresh();
    return clamped;
  }
  if (!startFloatingDockNativeTracker({ ...target.target, side })) {
    writeWindowsDockTrace('native-tracker-start-skip', {
      trackerType: 'windows-cursor-scan',
      targetId: target.target.id,
      targetWindowHandle: target.target.id,
      side,
      reason: 'native_tracker_start_failed_using_edge_poll',
    });
    startFloatingDockTracking();
  } else {
    writeWindowsDockTrace('native-tracker-started', {
      trackerType: 'windows-native-tracker',
      targetId: target.target.id,
      targetWindowHandle: target.target.id,
      side,
    });
  }
  return clamped;
}

function getCenteredBoundsInWorkArea(
  width: number,
  height: number,
  workArea: Electron.Rectangle
): Electron.Rectangle {
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

function isRectInsideWorkArea(rect: Electron.Rectangle, workArea: Electron.Rectangle) {
  return (
    rect.x >= workArea.x &&
    rect.y >= workArea.y &&
    rect.x + rect.width <= workArea.x + workArea.width &&
    rect.y + rect.height <= workArea.y + workArea.height
  );
}

function getSafeWindowDimension(requested: number, minimum: number, available: number) {
  const safeAvailable = Math.max(1, Math.floor(available));
  const preferred = Math.max(minimum, Math.round(requested));
  return Math.min(preferred, safeAvailable);
}

function getSafeRememberedModuleBounds(
  kind: ModuleWindowKind,
  workArea: Electron.Rectangle,
  minWidth: number,
  minHeight: number
) {
  const remembered = moduleWindowBoundsMemory.get(kind);
  if (!remembered || remembered.sidebarPosition !== currentSidebarPosition) return null;

  // A saved window can outlive the display it was saved on. Keep its size
  // useful on the current display, while preserving the user's position when
  // that position is still valid.
  const width = getSafeWindowDimension(
    remembered.bounds.width,
    minWidth,
    Math.min(workArea.width - WINDOW_MARGIN * 2, workArea.width * 0.9)
  );
  const height = getSafeWindowDimension(
    remembered.bounds.height,
    minHeight,
    Math.min(workArea.height - WINDOW_MARGIN * 2, workArea.height * 0.9)
  );
  const candidate = clampRectToWorkArea(
    { x: remembered.bounds.x, y: remembered.bounds.y, width, height },
    workArea
  );

  return isRectInsideWorkArea(candidate, workArea) ? candidate : null;
}

function resolveModuleBounds(kind: ModuleWindowKind): Electron.Rectangle {
  const defaultWidth = MODULE_DEFAULT_WIDTH;
  const defaultHeight = MODULE_DEFAULT_HEIGHT;
  const minWidth = MODULE_MIN_WIDTH;
  const minHeight = MODULE_MIN_HEIGHT;

  if (kind === 'notifications') {
    const sidebarBounds = sidebarWin?.getBounds() ?? getDockedBounds(RAIL_SIZE);
    const sidebarAnchorPoint = {
      x: Math.round(sidebarBounds.x + sidebarBounds.width / 2),
      y: Math.round(sidebarBounds.y + sidebarBounds.height / 2),
    };
    const display = screen.getDisplayNearestPoint(sidebarAnchorPoint);
    const workArea = display.workArea;
    return clampRectToWorkArea(
      getCenteredBoundsInWorkArea(NOTIFICATION_CENTER_WIDTH, NOTIFICATION_CENTER_HEIGHT, workArea),
      workArea
    );
  }
  const sidebarBounds = sidebarWin?.getBounds() ?? getDockedBounds(RAIL_SIZE);
  const sidebarAnchorPoint = {
    x: Math.round(sidebarBounds.x + sidebarBounds.width / 2),
    y: Math.round(sidebarBounds.y + sidebarBounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(sidebarAnchorPoint);
  const workArea = display.workArea;

  const shouldUseDockRelativePlacement =
    currentSidebarPosition === 'floating' &&
    Boolean(currentFloatingDockTarget && currentFloatingDockBounds);

  if (!shouldUseDockRelativePlacement) {
    const remembered = getSafeRememberedModuleBounds(kind, workArea, minWidth, minHeight);
    if (remembered) return remembered;
  }

  const targetWidth = getSafeWindowDimension(
    defaultWidth,
    minWidth,
    Math.min(workArea.width - WINDOW_MARGIN * 2, workArea.width * 0.9)
  );
  const targetHeight = getSafeWindowDimension(
    defaultHeight,
    minHeight,
    Math.min(workArea.height - WINDOW_MARGIN * 2, workArea.height * 0.9)
  );

  return clampRectToWorkArea(
    getCenteredBoundsInWorkArea(targetWidth, targetHeight, workArea),
    workArea
  );
}

function resolveWorkspaceModuleBounds(kind: ModuleWindowKind): Electron.Rectangle {
  const defaultWidth = kind === 'dashboard' ? DASHBOARD_WIDTH : MODULE_DEFAULT_WIDTH;
  const defaultHeight = kind === 'dashboard' ? DASHBOARD_HEIGHT : MODULE_DEFAULT_HEIGHT;
  const minWidth = MODULE_MIN_WIDTH;
  const minHeight = MODULE_MIN_HEIGHT;
  const attachmentGap = 0;

  const sidebarBounds = sidebarWin?.getBounds() ?? getDockedBounds(RAIL_SIZE);
  const sidebarAnchorPoint = {
    x: Math.round(sidebarBounds.x + sidebarBounds.width / 2),
    y: Math.round(sidebarBounds.y + sidebarBounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(sidebarAnchorPoint);
  const workArea = display.workArea;

  const shouldUseDockRelativePlacement =
    currentSidebarPosition === 'floating' &&
    Boolean(currentFloatingDockTarget && currentFloatingDockBounds);

  if (!shouldUseDockRelativePlacement) {
    const remembered = getSafeRememberedModuleBounds(kind, workArea, minWidth, minHeight);
    if (remembered) return remembered;
  }

  const targetWidth = getSafeWindowDimension(
    defaultWidth,
    minWidth,
    Math.min(workArea.width - WINDOW_MARGIN * 2, workArea.width * 0.9)
  );
  const targetHeight = getSafeWindowDimension(
    defaultHeight,
    minHeight,
    Math.min(workArea.height - WINDOW_MARGIN * 2, workArea.height * 0.9)
  );

  if (!shouldUseDockRelativePlacement) {
    return clampRectToWorkArea(
      getCenteredBoundsInWorkArea(targetWidth, targetHeight, workArea),
      workArea
    );
  }

  const leftSpace = sidebarBounds.x - workArea.x - attachmentGap - WINDOW_MARGIN;
  const rightSpace =
    workArea.x +
    workArea.width -
    (sidebarBounds.x + sidebarBounds.width) -
    attachmentGap -
    WINDOW_MARGIN;

  const preferredSide: 'left' | 'right' =
    currentSidebarPosition === 'left'
      ? 'right'
      : currentSidebarPosition === 'right'
      ? 'left'
      : rightSpace >= leftSpace
      ? 'right'
      : 'left';

  const canFitPreferred =
    preferredSide === 'right' ? rightSpace >= targetWidth : leftSpace >= targetWidth;
  const side: 'left' | 'right' = canFitPreferred
    ? preferredSide
    : rightSpace >= leftSpace
    ? 'right'
    : 'left';

  const sideSpace = side === 'right' ? rightSpace : leftSpace;
  const width = Math.max(minWidth, Math.min(targetWidth, Math.max(minWidth, sideSpace)));
  const height = targetHeight;

  const x =
    side === 'right'
      ? sidebarBounds.x + sidebarBounds.width + attachmentGap
      : sidebarBounds.x - width - attachmentGap;
  const y = sidebarBounds.y;
  const candidate = clampRectToWorkArea({ x, y, width, height }, workArea);
  const fitsWithoutOverlap =
    (side === 'right' && candidate.x >= sidebarBounds.x + sidebarBounds.width + attachmentGap) ||
    (side === 'left' && candidate.x + candidate.width <= sidebarBounds.x - attachmentGap);

  if (fitsWithoutOverlap && isRectInsideWorkArea(candidate, workArea)) {
    return candidate;
  }

  return clampRectToWorkArea(getCenteredBoundsInWorkArea(width, height, workArea), workArea);
}

function clampOpenModuleWindowsToDisplays() {
  const windows = new Set<BrowserWindow>(moduleWins.values());
  if (workspaceModuleWin && !workspaceModuleWin.isDestroyed()) windows.add(workspaceModuleWin);
  for (const record of detachedWindows.values()) {
    if (!record.win.isDestroyed()) windows.add(record.win);
  }

  for (const win of windows) {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) continue;
    // The floating sidebar owns this relationship. Let its dock tracker
    // restore the workspace window instead of fighting it during display
    // changes or DPI updates.
    if (win === workspaceModuleWin && isLedgerWindowDockTarget()) continue;

    const bounds = win.getBounds();
    const display = getDisplayForBounds(bounds);
    const workArea = display.workArea;
    const clamped = clampRectToWorkArea(
      {
        ...bounds,
        width: getSafeWindowDimension(
          bounds.width,
          MODULE_MIN_WIDTH,
          Math.min(workArea.width - WINDOW_MARGIN * 2, workArea.width * 0.9)
        ),
        height: getSafeWindowDimension(
          bounds.height,
          MODULE_MIN_HEIGHT,
          Math.min(workArea.height - WINDOW_MARGIN * 2, workArea.height * 0.9)
        ),
      },
      workArea
    );

    if (
      clamped.x !== bounds.x ||
      clamped.y !== bounds.y ||
      clamped.width !== bounds.width ||
      clamped.height !== bounds.height
    ) {
      win.setBounds(clamped, false);
    }
  }
}

function applySidebarWindowMode(mode: SidebarWindowMode, animate = true) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  const previousMode = currentSidebarMode;
  currentSidebarMode = mode;
  applySidebarOpacity(currentSidebarPreferences.opacity);

  if (mode === 'fullscreen') {
    floatingDockDragActive = false;
    clearCurrentFloatingDockTarget();
    stopFloatingDockTracking();
    syncTouchBar();
    const bounds = getCenteredBounds(DASHBOARD_WIDTH, DASHBOARD_HEIGHT);
    sidebarWin.setAlwaysOnTop(false);
    sidebarWin.setResizable(true);
    setWindowButtonVisibility(sidebarWin, true);
    setSidebarBounds(bounds, true);
    return;
  }

  if (mode === 'auth') {
    floatingDockDragActive = false;
    clearCurrentFloatingDockTarget();
    stopFloatingDockTracking();
    syncTouchBar();
    const bounds = getCenteredBoundsForCurrentSidebarDisplay(AUTH_WIDTH, AUTH_HEIGHT);
    sidebarWin.setAlwaysOnTop(false);
    sidebarWin.setResizable(false);
    setWindowButtonVisibility(sidebarWin, false);
    setSidebarBounds(bounds, false);
    return;
  }

  const isHorizontalDock = currentSidebarPosition === 'top' || currentSidebarPosition === 'bottom';
  const shouldRefreshLedgerWorkspaceDock =
    currentSidebarPosition === 'floating' &&
    isLedgerWindowDockTarget() &&
    Boolean(workspaceModuleKind) &&
    Boolean(workspaceModuleWin && !workspaceModuleWin.isDestroyed());
  if (currentSidebarPosition === 'floating' && currentFloatingDockTarget) {
    holdCurrentFloatingDockTarget(2000);
  }
  const bounds =
    currentSidebarPosition === 'floating'
      ? getFloatingBounds(mode)
      : isHorizontalDock
      ? mode === 'expanded'
        ? getDockedBounds(HORIZONTAL_DOCK_WIDTH)
        : getCollapsedBounds(HORIZONTAL_COLLAPSED_HEIGHT)
      : mode === 'compact'
      ? getCollapsedBounds(COLLAPSED_SIZE)
      : mode === 'minimized'
      ? getDockedBounds(RAIL_SIZE)
      : getDockedBounds(EXPANDED_WIDTH);
  const shouldAlwaysOnTop = sidebarAlwaysOnTop || currentSidebarShellFullscreen;
  sidebarWin.setAlwaysOnTop(shouldAlwaysOnTop, 'screen-saver');
  sidebarWin.setResizable(false);
  setWindowButtonVisibility(sidebarWin, false);
  const isOpeningSidebar = mode === 'expanded' && previousMode !== 'expanded';
  syncTouchBar();
  setSidebarBounds(bounds, animate && (!isOpeningSidebar || isHorizontalDock));
  if (shouldRefreshLedgerWorkspaceDock) {
    setTimeout(() => {
      if (floatingDockDragActive) return;
      if (currentSidebarPosition !== 'floating') return;
      if (!workspaceModuleKind || !workspaceModuleWin || workspaceModuleWin.isDestroyed()) return;
      if (!shouldAttachWorkspaceWindowToSidebar()) return;
      setWorkspaceWindowAsFloatingDockTarget(workspaceModuleKind);
      applyWorkspaceDockTargetBounds();
    }, 260);
  }
}

function applySidebarAlwaysOnTop(alwaysOnTop: boolean) {
  sidebarAlwaysOnTop = alwaysOnTop;
  if (!sidebarWin || sidebarWin.isDestroyed()) return;

  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') {
    sidebarWin.setAlwaysOnTop(false);
    return;
  }

  sidebarWin.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
}

function applySidebarOpacity(_opacity: number) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  // Do not use window.setOpacity() as it makes all content transparent.
  // Instead, opacity is sent to renderer via IPC where it controls CSS variables
  // that only affect the background glass layer, keeping content fully opaque.
  // Renderer receives opacity via sidebar:preferences-updated IPC message.
}

function applySidebarVisibility(isVisible: boolean, activate = false) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return;

  if (allLedgerWindowsHidden && isVisible) {
    allLedgerWindowsHidden = false;
    moduleKindsVisibleBeforeHideAll.clear();
  }

  sidebarIsVisible = isVisible;

  if (!isVisible) {
    sidebarWin.hide();
    sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: false });
    return;
  }

  if (activate) {
    sidebarWin.show();
    sidebarWin.focus();
  } else {
    sidebarWin.showInactive();
  }
  applySidebarWindowMode(currentSidebarMode);
  sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: true });
}

function focusSidebarWindow() {
  if (!sidebarWin || sidebarWin.isDestroyed()) {
    createSidebarWindow();
    return;
  }

  if (sidebarWin.isMinimized()) {
    sidebarWin.restore();
  }

  if (!sidebarWin.isVisible()) {
    applySidebarVisibility(true);
  } else {
    sidebarWin.show();
    applySidebarWindowMode(currentSidebarMode);
    sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: true });
  }

  sidebarWin.focus();
}

function quitLedgerApp() {
  isQuittingApp = true;
  app.quit();
}

async function toggleNotificationsPaused() {
  if (!notificationAccessToken) return;

  try {
    const preferences = await fetchLedgerApi<Record<string, unknown>>(
      '/api/notifications/preferences',
      notificationAccessToken
    );
    const nextPaused = !Boolean(preferences?.paused);
    const updatedPreferences = await fetchLedgerApi<Record<string, unknown>>(
      '/api/notifications/preferences',
      notificationAccessToken,
      {
        method: 'PATCH',
        body: JSON.stringify({ paused: nextPaused }),
      }
    );
    cachedNotificationPreferences = updatedPreferences as NotificationPreferencesPayload;
    cachedNotificationPreferencesAt = Date.now();
    updateTrayState({ notificationsPaused: nextPaused });
    queueNotificationSchedulerRun(0);
  } catch (error) {
    console.warn('[electron] Failed to toggle notification pause state', error);
  }
}

function hideAllLedgerWindows() {
  if (allLedgerWindowsHidden) return;

  sidebarWasVisibleBeforeHideAll = Boolean(
    sidebarWin && !sidebarWin.isDestroyed() && sidebarWin.isVisible()
  );
  moduleKindsVisibleBeforeHideAll.clear();

  for (const [kind, moduleWin] of moduleWins.entries()) {
    if (moduleWin.isDestroyed()) continue;
    if (moduleWin.isVisible() && !moduleWin.isMinimized()) {
      moduleKindsVisibleBeforeHideAll.add(kind);
      moduleWin.hide();
    }
  }

  if (sidebarWin && !sidebarWin.isDestroyed() && sidebarWin.isVisible()) {
    sidebarWin.hide();
    sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: false });
  }

  allLedgerWindowsHidden = true;
}

function restoreAllLedgerWindows() {
  if (!allLedgerWindowsHidden) return;

  if (sidebarWasVisibleBeforeHideAll && sidebarWin && !sidebarWin.isDestroyed()) {
    sidebarWin.show();
    applySidebarWindowMode(currentSidebarMode);
    sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: true });
  }

  for (const kind of moduleKindsVisibleBeforeHideAll) {
    const moduleWin = moduleWins.get(kind);
    if (!moduleWin || moduleWin.isDestroyed()) continue;
    if (moduleWin.isMinimized()) moduleWin.restore();
    moduleWin.show();
  }

  moduleKindsVisibleBeforeHideAll.clear();
  allLedgerWindowsHidden = false;
}

function toggleAllLedgerWindowsVisibility() {
  if (allLedgerWindowsHidden) {
    restoreAllLedgerWindows();
    return;
  }
  hideAllLedgerWindows();
}

function getRendererUrl(search: string) {
  if (VITE_DEV_SERVER_URL) {
    return `${VITE_DEV_SERVER_URL}${search}`;
  }
  return `file://${path.join(RENDERER_DIST, 'index.html')}${search}`;
}

function attachNativeContextMenu(win: BrowserWindow) {
  win.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    const suggestions = Array.isArray(params.dictionarySuggestions)
      ? params.dictionarySuggestions
      : [];
    const hasSuggestions = suggestions.length > 0;

    if (hasSuggestions) {
      for (const suggestion of suggestions.slice(0, 6)) {
        template.push({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion),
        });
      }
      template.push({ type: 'separator' });
    }

    if (params.misspelledWord) {
      template.push({
        label: 'Add to Dictionary',
        click: () => {
          if (!params.misspelledWord) return;
          win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
        },
      });
      template.push({ type: 'separator' });
    }

    if (params.isEditable) {
      template.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      );
    } else if (params.selectionText?.trim()) {
      template.push({ role: 'copy' });
    }

    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function createSidebarWindow() {
  sidebarWin = new BrowserWindow({
    ...getCenteredBounds(AUTH_WIDTH, AUTH_HEIGHT),
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: process.platform === 'win32',
    resizable: false,
    alwaysOnTop: false,
    ...getWindowChromeOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      spellcheck: true,
    },
  });

  sidebarWin.setMenuBarVisibility(false);
  sidebarWin.setMenu(null);
  // Hide native window buttons immediately to prevent startup flash before
  // renderer-side mode synchronization runs.
  setWindowButtonVisibility(sidebarWin, false);

  if (process.platform === 'win32' && typeof (sidebarWin as any).setHasShadow === 'function') {
    try {
      (sidebarWin as any).setHasShadow(false);
    } catch {}
  }

  // Keep sidebar translucency pure RGBA/CSS-only to avoid platform compositor blur artifacts.

  lockWindowZoom(sidebarWin);
  attachWindowsCloseShortcut(sidebarWin);
  attachNativeContextMenu(sidebarWin);
  applyWindowsModuleWindowShape(sidebarWin);

  // Keep the sidebar rendering path purely CSS-based for consistent frosted glass.

  sidebarWin.on('closed', () => {
    stopFloatingDockTracking();
    clearCurrentFloatingDockTarget();
    stopMacDockHelper();
    sidebarWin = null;
    for (const [kind, moduleWin] of moduleWins.entries()) {
      if (!moduleWin.isDestroyed()) moduleWin.close();
      moduleWins.delete(kind);
    }
  });

  sidebarWin.on('close', (event) => {
    if (!isQuittingApp && trayState.runInBackground) {
      event.preventDefault();
      applySidebarVisibility(false);
      return;
    }
    if (process.platform !== 'darwin') return;
    if (currentSidebarMode !== 'fullscreen') return;

    event.preventDefault();
    sidebarWin?.webContents.send('sidebar:state-changed', { state: 'minimized' });
    applySidebarWindowMode('minimized');
  });

  try {
    const rendererUrl = VITE_DEV_SERVER_URL
      ? VITE_DEV_SERVER_URL
      : `file://${path.join(RENDERER_DIST, 'index.html')}`;
    if (VITE_DEV_SERVER_URL) {
      sidebarWin.loadURL(rendererUrl);
    } else {
      sidebarWin.loadFile(path.join(RENDERER_DIST, 'index.html'));
    }
    // Diagnostics: listen for renderer load failures and crashes
    sidebarWin.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL) => {
        console.error('[electron][sidebar] did-fail-load', {
          errorCode,
          errorDescription,
          validatedURL,
        });
      }
    );

    sidebarWin.webContents.on('did-finish-load', () => {
      try {
        if (sidebarWin && !sidebarWin.isDestroyed()) {
          sidebarWin.webContents.send('app:did-finish-load');
          processPendingInviteToken();
          if (sidebarWin.isMinimized()) {
            sidebarWin.restore();
          }
          const nextBounds =
            currentSidebarMode === 'auth'
              ? getCenteredBoundsForCurrentSidebarDisplay(AUTH_WIDTH, AUTH_HEIGHT)
              : currentSidebarMode === 'fullscreen'
              ? getCenteredBounds(DASHBOARD_WIDTH, DASHBOARD_HEIGHT)
              : currentSidebarMode === 'minimized'
              ? currentSidebarPosition === 'top' || currentSidebarPosition === 'bottom'
                ? getCollapsedBounds(HORIZONTAL_COLLAPSED_HEIGHT)
                : currentSidebarPreferences.isExpanded
                ? getDockedBounds(RAIL_SIZE)
                : getCollapsedBounds(COLLAPSED_SIZE)
              : currentSidebarPosition === 'top' || currentSidebarPosition === 'bottom'
              ? getDockedBounds(HORIZONTAL_DOCK_WIDTH)
              : getDockedBounds(EXPANDED_WIDTH);
          sidebarWin.setBounds(nextBounds);
          applyWindowsModuleWindowShape(sidebarWin);
          sidebarWin.showInactive();
          console.log('[electron][sidebar] window bounds reset:', nextBounds);
        }
      } catch (err) {
        console.error('[electron][sidebar] did-finish-load handler error', err);
      }
    });

    sidebarWin.webContents.on('render-process-gone', (_event, details) => {
      console.error('[electron][sidebar] render-process-gone', details);
    });

    sidebarWin.on('resize', () => {
      if (sidebarWin && !sidebarWin.isDestroyed()) {
        applyWindowsModuleWindowShape(sidebarWin);
      }
    });

    sidebarWin.on('move', () => {
      if (!sidebarWin || sidebarWin.isDestroyed()) return;
      if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return;
      syncCurrentFloatingPosition(sidebarWin.getBounds());
    });
  } catch (err) {
    console.error('[electron] Error while loading sidebar renderer:', err);
  }
}

function sendModuleFocus(
  kind: ModuleWindowKind,
  focusDate?: string | null,
  focusProjectId?: string | null,
  focusNoteId?: string | null,
  focusTaskId?: string | null,
  focusContext?: string | null,
  focusSection?: string | null,
  targetWin?: BrowserWindow
) {
  const existing = targetWin ?? moduleWins.get(kind);
  if (existing && !existing.isDestroyed()) {
    if (focusDate) {
      existing.webContents.send('module:focus-date', { kind, focusDate });
    }
    if (focusProjectId) {
      existing.webContents.send('module:focus-project', { kind, focusProjectId });
    }
    if (focusNoteId) {
      existing.webContents.send('module:focus-note', { kind, focusNoteId });
    }
    if (focusTaskId) {
      existing.webContents.send('module:focus-task', { kind, focusTaskId });
    }
    if (focusContext) {
      existing.webContents.send('module:focus-context', { kind, focusContext });
    }
    if (kind === 'settings' && focusSection) {
      existing.webContents.send('settings:focus-section', { section: focusSection });
    }
    if (focusSection) {
      existing.webContents.send('module:focus-section', { kind, focusSection });
    }
  }
}

function isWorkspaceModuleKind(kind: ModuleWindowKind) {
  return (
    kind === 'new-tab' ||
    kind === 'dashboard' ||
    kind === 'circle' ||
    kind === 'calendar' ||
    kind === 'notes' ||
    kind === 'projects' ||
    kind === 'teams' ||
    kind === 'settings' ||
    kind === 'inbox'
  );
}

function getWorkspaceNavigationState() {
  return {
    canGoBack: workspaceModuleBackStack.length > 0,
    canGoForward: workspaceModuleForwardStack.length > 0,
    currentModule: workspaceModuleKind,
    currentRoute: getCurrentWorkspaceRoute(),
    recentRoutes: workspaceModuleRecentRoutes.map((route) => ({ ...route })),
  };
}

function getNavigationStateForWindow(win: BrowserWindow | null | undefined) {
  const detached = getDetachedWindowRecord(win);
  if (!detached) return getWorkspaceNavigationState();
  return {
    canGoBack: detached.backStack.length > 0,
    canGoForward: detached.forwardStack.length > 0,
    currentModule: detached.route.kind,
    currentRoute: { ...detached.route },
    recentRoutes: detached.recentRoutes.map((route) => ({ ...route })),
    windowId: detached.id,
  };
}

function sendNavigationStateToWindow(win: BrowserWindow) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('workspace:navigation-state', getNavigationStateForWindow(win));
}

function broadcastWorkspaceNavigationState() {
  const state = getWorkspaceNavigationState();
  const targets = new Set<BrowserWindow>();
  if (sidebarWin && !sidebarWin.isDestroyed()) {
    targets.add(sidebarWin);
  }
  if (workspaceModuleWin && !workspaceModuleWin.isDestroyed()) {
    targets.add(workspaceModuleWin);
  }
  for (const win of moduleWins.values()) {
    if (!win.isDestroyed()) targets.add(win);
  }
  for (const win of targets) {
    win.webContents.send('workspace:navigation-state', state);
  }
}

function sendDetachedRouteChanged(record: DetachedWindowRecord) {
  if (record.win.isDestroyed()) return;
  sendWorkspaceRouteChanged(record.win, record.route);
  sendModuleFocus(
    record.route.kind,
    record.route.focusDate,
    record.route.focusProjectId,
    record.route.focusNoteId,
    record.route.focusTaskId,
    record.route.focusContext,
    record.route.focusSection,
    record.win
  );
  sendNavigationStateToWindow(record.win);
}

function navigateDetachedWindow(
  record: DetachedWindowRecord,
  route: WorkspaceModuleRoute,
  pushHistory = true
) {
  if (pushHistory && !isSameWorkspaceRoute(record.route, route)) {
    record.backStack.push({ ...record.route });
    record.forwardStack.length = 0;
  }
  record.route = { ...route };
  const existingIndex = record.recentRoutes.findIndex((entry) =>
    isSameWorkspaceRoute(entry, route)
  );
  if (existingIndex >= 0) record.recentRoutes.splice(existingIndex, 1);
  record.recentRoutes.unshift({ ...route });
  record.recentRoutes.length = Math.min(record.recentRoutes.length, 12);
  sendDetachedRouteChanged(record);
  return true;
}

function navigateDetachedHistory(record: DetachedWindowRecord, direction: 'back' | 'forward') {
  const target = direction === 'back' ? record.backStack.pop() : record.forwardStack.pop();
  if (!target) {
    sendNavigationStateToWindow(record.win);
    return;
  }
  if (direction === 'back') record.forwardStack.push({ ...record.route });
  else record.backStack.push({ ...record.route });
  navigateDetachedWindow(record, target, false);
}

function routeFromModuleArgs(
  kind: ModuleWindowKind,
  focusDate?: string | null,
  focusProjectId?: string | null,
  focusNoteId?: string | null,
  focusTaskId?: string | null,
  focusContext?: string | null,
  focusSection?: string | null
): WorkspaceModuleRoute {
  return {
    kind,
    focusDate: focusDate ?? null,
    focusProjectId: focusProjectId ?? null,
    focusNoteId: focusNoteId ?? null,
    focusTaskId: focusTaskId ?? null,
    focusContext: focusContext ?? null,
    focusSection: focusSection ?? null,
  };
}

function recordWorkspaceRoute(route: WorkspaceModuleRoute) {
  const existingIndex = workspaceModuleRecentRoutes.findIndex((entry) =>
    isSameWorkspaceRoute(entry, route)
  );
  if (existingIndex >= 0) {
    workspaceModuleRecentRoutes.splice(existingIndex, 1);
  }

  workspaceModuleRecentRoutes.unshift({ ...route });
  workspaceModuleRecentRoutes.length = Math.min(workspaceModuleRecentRoutes.length, 12);
}

function isSameWorkspaceRoute(a: WorkspaceModuleRoute | null, b: WorkspaceModuleRoute) {
  return (
    a?.kind === b.kind &&
    (a.focusDate ?? null) === (b.focusDate ?? null) &&
    (a.focusProjectId ?? null) === (b.focusProjectId ?? null) &&
    (a.focusNoteId ?? null) === (b.focusNoteId ?? null) &&
    (a.focusTaskId ?? null) === (b.focusTaskId ?? null) &&
    (a.focusContext ?? null) === (b.focusContext ?? null) &&
    (a.focusSection ?? null) === (b.focusSection ?? null)
  );
}

function buildModuleUrl(
  route: WorkspaceModuleRoute,
  options: { windowId?: string; detached?: boolean; transferId?: string } = {}
) {
  const focusDateQuery = route.focusDate ? `&focusDate=${encodeURIComponent(route.focusDate)}` : '';
  const focusProjectQuery = route.focusProjectId
    ? `&focusProjectId=${encodeURIComponent(route.focusProjectId)}`
    : '';
  const focusNoteQuery = route.focusNoteId
    ? `&focusNoteId=${encodeURIComponent(route.focusNoteId)}`
    : '';
  const focusTaskQuery = route.focusTaskId
    ? `&focusTaskId=${encodeURIComponent(route.focusTaskId)}`
    : '';
  const focusContextQuery = route.focusContext
    ? `&focusContext=${encodeURIComponent(route.focusContext)}`
    : '';
  const focusSectionQuery = route.focusSection
    ? `&section=${encodeURIComponent(route.focusSection)}`
    : '';
  const windowIdQuery = options.windowId ? `&windowId=${encodeURIComponent(options.windowId)}` : '';
  const detachedQuery = options.detached ? '&detached=1' : '';
  const transferIdQuery = options.transferId
    ? `&tabTransferId=${encodeURIComponent(options.transferId)}`
    : '';
  return getRendererUrl(
    `?window=module&module=${route.kind}${focusDateQuery}${focusProjectQuery}${focusNoteQuery}${focusTaskQuery}${focusContextQuery}${focusSectionQuery}${windowIdQuery}${detachedQuery}${transferIdQuery}`
  );
}

function getCurrentWorkspaceRoute(): WorkspaceModuleRoute | null {
  if (!workspaceModuleKind || !workspaceModuleCurrentRoute) return null;
  return { ...workspaceModuleCurrentRoute };
}

function registerWorkspaceModuleKind(
  kind: ModuleWindowKind,
  win: BrowserWindow,
  route?: WorkspaceModuleRoute
) {
  if (workspaceModuleKind && workspaceModuleKind !== kind) {
    moduleWins.delete(workspaceModuleKind);
  }
  workspaceModuleKind = kind;
  workspaceModuleCurrentRoute = route ? { ...route } : routeFromModuleArgs(kind);
  workspaceModuleWin = win;
  moduleWins.set(kind, win);
}

function sendWorkspaceRouteChanged(win: BrowserWindow, route: WorkspaceModuleRoute) {
  win.webContents.send('workspace:route-changed', {
    kind: route.kind,
    focusDate: route.focusDate,
    focusProjectId: route.focusProjectId,
    focusNoteId: route.focusNoteId,
    focusTaskId: route.focusTaskId,
    focusContext: route.focusContext,
    focusSection: route.focusSection,
  });
}

function navigateWorkspaceModuleWindow(route: WorkspaceModuleRoute, pushHistory = true) {
  const moduleWin = workspaceModuleWin;
  if (!moduleWin || moduleWin.isDestroyed()) return false;

  const currentRoute = getCurrentWorkspaceRoute();
  if (pushHistory && currentRoute && !isSameWorkspaceRoute(currentRoute, route)) {
    workspaceModuleBackStack.push(currentRoute);
    workspaceModuleForwardStack.length = 0;
  }

  registerWorkspaceModuleKind(route.kind, moduleWin, route);
  recordWorkspaceRoute(route);
  setWorkspaceWindowAsFloatingDockTarget(route.kind);

  const shouldKeepFullscreen =
    isWorkspaceModuleKind(route.kind) &&
    (Boolean(workspaceShellFullscreenRestoreBounds) ||
      currentSidebarMode === 'fullscreen' ||
      moduleWin.isFullScreen());

  if (moduleWin.isMinimized()) {
    moduleWin.restore();
  }
  moduleWin.show();
  moduleWin.focus();

  if (moduleWin.webContents.isLoading()) {
    moduleWin.webContents.once('did-finish-load', () => {
      if (moduleWin.isDestroyed()) return;
      applyWindowsModuleWindowShape(moduleWin);
      sendModuleFullscreenState(route.kind, moduleWin, shouldKeepFullscreen);
      sendWorkspaceRouteChanged(moduleWin, route);
      sendModuleFocus(
        route.kind,
        route.focusDate,
        route.focusProjectId,
        route.focusNoteId,
        route.focusTaskId,
        route.focusContext,
        route.focusSection
      );
      broadcastWorkspaceNavigationState();
    });
  } else {
    sendModuleFullscreenState(route.kind, moduleWin, shouldKeepFullscreen);
    sendWorkspaceRouteChanged(moduleWin, route);
    sendModuleFocus(
      route.kind,
      route.focusDate,
      route.focusProjectId,
      route.focusNoteId,
      route.focusTaskId,
      route.focusContext,
      route.focusSection
    );
  }

  if (shouldKeepFullscreen) {
    enterModuleWindowFullscreen(route.kind, moduleWin);
  }

  broadcastWorkspaceNavigationState();
  return true;
}

function updateWorkspaceModuleRoute(route: WorkspaceModuleRoute) {
  const moduleWin = workspaceModuleWin;
  if (!moduleWin || moduleWin.isDestroyed()) return false;
  const currentRoute = getCurrentWorkspaceRoute();
  if (currentRoute && isSameWorkspaceRoute(currentRoute, route)) {
    broadcastWorkspaceNavigationState();
    return true;
  }

  if (currentRoute) {
    workspaceModuleBackStack.push(currentRoute);
  }
  workspaceModuleForwardStack.length = 0;

  registerWorkspaceModuleKind(route.kind, moduleWin, route);
  recordWorkspaceRoute(route);
  setWorkspaceWindowAsFloatingDockTarget(route.kind);
  if (
    isWorkspaceModuleKind(route.kind) &&
    (Boolean(workspaceShellFullscreenRestoreBounds) ||
      currentSidebarMode === 'fullscreen' ||
      moduleWin.isFullScreen())
  ) {
    enterModuleWindowFullscreen(route.kind, moduleWin);
  }
  broadcastWorkspaceNavigationState();
  return true;
}

function navigateWorkspaceHistory(direction: 'back' | 'forward') {
  const target =
    direction === 'back' ? workspaceModuleBackStack.pop() : workspaceModuleForwardStack.pop();
  if (!target || !workspaceModuleWin || workspaceModuleWin.isDestroyed()) {
    broadcastWorkspaceNavigationState();
    return;
  }

  const currentRoute = getCurrentWorkspaceRoute();
  if (currentRoute) {
    if (direction === 'back') {
      workspaceModuleForwardStack.push(currentRoute);
    } else {
      workspaceModuleBackStack.push(currentRoute);
    }
  }

  navigateWorkspaceModuleWindow(target, false);
}

type OpenModuleWindowOptions = {
  detachedWindowId?: string;
  initialBounds?: Electron.Rectangle;
  detachedTabSession?: DetachedTabSession;
  transferId?: string;
};

function openModuleWindow(
  kind: ModuleWindowKind,
  focusDate?: string | null,
  focusProjectId?: string | null,
  focusNoteId?: string | null,
  focusTaskId?: string | null,
  focusContext?: string | null,
  focusSection?: string | null,
  options: OpenModuleWindowOptions = {}
) {
  const isDetachedWindow = Boolean(options.detachedWindowId);
  const workspaceRoute = routeFromModuleArgs(
    kind,
    focusDate,
    focusProjectId,
    focusNoteId,
    focusTaskId,
    focusContext,
    focusSection
  );
  const notesHomeRoute =
    kind === 'notes'
      ? routeFromModuleArgs(
          kind,
          focusDate,
          focusProjectId,
          null,
          focusTaskId,
          'home',
          focusSection
        )
      : null;
  if (
    !isDetachedWindow &&
    isWorkspaceModuleKind(kind) &&
    workspaceModuleWin &&
    !workspaceModuleWin.isDestroyed() &&
    workspaceModuleKind !== kind
  ) {
    holdCurrentFloatingDockTarget();
    setWorkspaceWindowAsFloatingDockTarget(kind);
    if (notesHomeRoute) {
      navigateWorkspaceModuleWindow(notesHomeRoute);
    }
    navigateWorkspaceModuleWindow(workspaceRoute);
    return;
  }

  const existing = isDetachedWindow ? null : moduleWins.get(kind);
  if (existing && !existing.isDestroyed()) {
    holdCurrentFloatingDockTarget();
    if (isWorkspaceModuleKind(kind)) {
      if (shouldAttachWorkspaceWindowToSidebar() && !workspaceShellFullscreenRestoreBounds) {
        existing.setBounds(resolveWorkspaceModuleBounds(kind), false);
        setWorkspaceWindowAsFloatingDockTarget(kind);
      }
    } else if (
      currentSidebarPosition === 'floating' &&
      currentFloatingDockTarget &&
      currentFloatingDockBounds
    ) {
      existing.setBounds(resolveModuleBounds(kind), false);
    }
    existing.show();
    // Delay focus to prevent sidebar from stealing focus back
    setTimeout(() => {
      if (!existing.isDestroyed()) {
        existing.focus();
      }
    }, 100);
    if (isWorkspaceModuleKind(kind)) {
      const currentRoute = getCurrentWorkspaceRoute();
      if (currentRoute && !isSameWorkspaceRoute(currentRoute, workspaceRoute)) {
        workspaceModuleBackStack.push(currentRoute);
        workspaceModuleForwardStack.length = 0;
      }
      registerWorkspaceModuleKind(kind, existing, workspaceRoute);
      recordWorkspaceRoute(workspaceRoute);
    }
    sendModuleFocus(
      kind,
      focusDate,
      focusProjectId,
      focusNoteId,
      focusTaskId,
      focusContext,
      focusSection
    );
    broadcastWorkspaceNavigationState();
    return;
  }

  // Quick capture modules use smaller dimensions
  const isQuickCapture =
    kind === 'quick-task' ||
    kind === 'quick-note' ||
    kind === 'quick-event' ||
    kind === 'quick-reminder';
  const isNotificationCenter = kind === 'notifications';
  if (!isDetachedWindow) {
    holdCurrentFloatingDockTarget();
  }
  let initialBounds =
    options.initialBounds ??
    (isWorkspaceModuleKind(kind) && shouldAttachWorkspaceWindowToSidebar()
      ? resolveWorkspaceModuleBounds(kind)
      : resolveModuleBounds(kind));

  if (isQuickCapture) {
    const displayForModule = screen.getDisplayMatching(initialBounds).workArea;
    initialBounds = {
      x: displayForModule.x + displayForModule.width - QUICK_CAPTURE_WIDTH - WINDOW_MARGIN,
      y: displayForModule.y + displayForModule.height - QUICK_CAPTURE_HEIGHT - WINDOW_MARGIN,
      width: QUICK_CAPTURE_WIDTH,
      height: QUICK_CAPTURE_HEIGHT,
    };
  }

  const minWidth = isQuickCapture
    ? QUICK_CAPTURE_WIDTH
    : isNotificationCenter
    ? NOTIFICATION_CENTER_MIN_WIDTH
    : MODULE_MIN_WIDTH;
  const minHeight = isQuickCapture
    ? QUICK_CAPTURE_HEIGHT
    : isNotificationCenter
    ? NOTIFICATION_CENTER_MIN_HEIGHT
    : MODULE_MIN_HEIGHT;

  const moduleWin = new BrowserWindow({
    ...initialBounds,
    show: false,
    transparent: process.platform !== 'win32',
    backgroundColor: process.platform === 'win32' ? getNativeWindowBackgroundColor() : '#00000000',
    roundedCorners: process.platform === 'win32',
    ...getModuleWindowChromeOptions(),
    // Ensure module popouts can enter/exit fullscreen reliably on Windows and macOS
    fullscreenable: true,
    minWidth: Math.min(minWidth, initialBounds.width),
    minHeight: Math.min(minHeight, initialBounds.height),
    resizable: !isQuickCapture,
    minimizable: !isQuickCapture,
    maximizable: !isQuickCapture,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      spellcheck: true,
    },
  });

  moduleWin.setMenuBarVisibility(false);
  moduleWin.setMenu(null);

  // Rounded module shells rely on transparent corner cutouts; vibrancy can
  // render dark artifacts in those cutouts on macOS.
  if (process.platform === 'darwin') {
    moduleWin.setVibrancy(null);
  }

  // Windows native shadows are rectangular behind transparent/rounded shells.
  // Keep them off there; macOS uses the native panel shadow correctly.
  if (typeof (moduleWin as any).setHasShadow === 'function') {
    try {
      (moduleWin as any).setHasShadow(process.platform !== 'win32');
    } catch {}
  }
  applyWindowsModuleWindowShape(moduleWin);

  lockWindowZoom(moduleWin);
  if (!isWorkspaceModuleKind(kind)) {
    attachWindowsCloseShortcut(moduleWin);
  }
  attachNativeContextMenu(moduleWin);

  if (isDetachedWindow && options.detachedWindowId) {
    const session = options.detachedTabSession;
    const history = session?.tabHistory?.length ? session.tabHistory : [workspaceRoute];
    const historyIndex = Math.max(
      0,
      Math.min(session?.historyIndex ?? history.length - 1, history.length - 1)
    );
    detachedWindows.set(options.detachedWindowId, {
      id: options.detachedWindowId,
      win: moduleWin,
      route: { ...(session?.route ?? workspaceRoute) },
      backStack: history.slice(0, historyIndex).map((route) => ({ ...route })),
      forwardStack: history.slice(historyIndex + 1).map((route) => ({ ...route })),
      recentRoutes: history.map((route) => ({ ...route })),
    });
  } else if (isWorkspaceModuleKind(kind)) {
    registerWorkspaceModuleKind(kind, moduleWin, notesHomeRoute ?? workspaceRoute);
    recordWorkspaceRoute(notesHomeRoute ?? workspaceRoute);
    setWorkspaceWindowAsFloatingDockTarget(kind);
  } else {
    moduleWins.set(kind, moduleWin);
  }

  moduleWin.on('minimize', () => {
    if (isDetachedWindow) {
      sidebarWin?.webContents.send('module:state-changed', { kind, state: 'minimized' });
      return;
    }
    if (moduleWin === workspaceModuleWin && isWorkspaceDockTarget()) {
      minimizeSidebarWithWorkspaceShell();
      suspendWorkspaceWindowDockTarget();
    } else {
      suspendCurrentFloatingDockTarget('suspended_minimized');
    }
    sidebarWin?.webContents.send('module:state-changed', { kind, state: 'minimized' });
  });

  moduleWin.on('close', () => {
    sidebarWin?.webContents.send('module:state-changed', { kind, state: 'closed' });
  });

  moduleWin.on('closed', () => {
    const detachedRecord = getDetachedWindowRecord(moduleWin);
    if (detachedRecord) {
      detachedWindows.delete(detachedRecord.id);
      for (const [transferId, pending] of pendingTabDetaches) {
        if (pending.target === moduleWin) {
          pendingTabDetaches.delete(transferId);
          pending.resolve(false);
        }
      }
    }
    if (moduleWin === workspaceModuleWin) {
      setSidebarAboveWorkspaceWindow(false);
      workspaceSidebarMinimizedWithShell = false;
    }
    const shouldRestoreFloatingSidebar =
      moduleWin === workspaceModuleWin &&
      currentSidebarPosition === 'floating' &&
      Boolean(currentFloatingDockTarget);
    if (!detachedRecord) {
      moduleWins.delete(kind);
    }
    if (workspaceModuleWin === moduleWin) {
      if (isWorkspaceDockTarget()) {
        clearCurrentFloatingDockTarget('target_closed');
        stopFloatingDockTracking();
      }
      cancelWorkspaceDockRefresh();
      if (workspaceModuleKind) {
        moduleWins.delete(workspaceModuleKind);
      }
      workspaceModuleWin = null;
      workspaceModuleKind = null;
      workspaceModuleCurrentRoute = null;
      workspaceShellFullscreenRestoreBounds = null;
      workspaceModuleBackStack.length = 0;
      workspaceModuleForwardStack.length = 0;
      workspaceModuleRecentRoutes.length = 0;
      broadcastWorkspaceNavigationState();
    }
    if (!detachedRecord) {
      moduleWindowFullscreenBoundsMemory.delete(kind);
    }
    if (shouldRestoreFloatingSidebar && currentSidebarMode !== 'auth') {
      sidebarWin?.webContents.send('sidebar:state-changed', { state: 'minimized' });
      applySidebarWindowMode('minimized', true);
    }
  });

  let resizeShadowRestoreTimer: NodeJS.Timeout | null = null;
  const setModuleShadow = (enabled: boolean) => {
    if (process.platform !== 'win32') return;
    try {
      if (!moduleWin.isDestroyed() && typeof (moduleWin as any).setHasShadow === 'function') {
        (moduleWin as any).setHasShadow(Boolean(enabled));
      }
    } catch {}
  };

  moduleWin.on('will-resize', () => {
    if (process.platform !== 'win32') return;
    if (resizeShadowRestoreTimer !== null) {
      clearTimeout(resizeShadowRestoreTimer);
      resizeShadowRestoreTimer = null;
    }
    setModuleShadow(false);
  });

  moduleWin.on('resize', () => {
    if (process.platform !== 'win32') return;
    if (resizeShadowRestoreTimer !== null) {
      clearTimeout(resizeShadowRestoreTimer);
    }
    resizeShadowRestoreTimer = setTimeout(() => {
      resizeShadowRestoreTimer = null;
      setModuleShadow(false);
      applyWindowsModuleWindowShape(moduleWin);
    }, 160);
  });
  moduleWin.on('resized', () => {
    applyWindowsModuleWindowShape(moduleWin);
    if (moduleWin === workspaceModuleWin && isLedgerWindowDockTarget()) {
      scheduleWorkspaceDockRefresh();
    }
  });
  moduleWin.on('moved', () => {
    if (moduleWin === workspaceModuleWin && isLedgerWindowDockTarget()) {
      if (headerDragStarts.has(moduleWin.webContents.id)) return;
      scheduleWorkspaceDockRefresh(16);
    }
  });
  moduleWin.on('restore', () => {
    if (moduleWin === workspaceModuleWin && shouldAttachWorkspaceWindowToSidebar()) {
      restoreSidebarAfterWorkspaceShellMinimize();
      setWorkspaceWindowAsFloatingDockTarget(kind);
    }
  });

  moduleWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[electron][${kind}] did-fail-load`, {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  moduleWin.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[electron][${kind}] render-process-gone`, details);
  });

  moduleWin.webContents.on('unresponsive', () => {
    console.error(`[electron][${kind}] unresponsive`);
  });

  // Ensure fullscreen can be exited with Escape or F11 reliably on all platforms.
  moduleWin.webContents.on('before-input-event', (event, input) => {
    try {
      const key = String(input.key ?? '').toLowerCase();
      const detachedRecord = getDetachedWindowRecord(moduleWin);
      const isWorkspaceHistoryShortcut =
        ((moduleWin === workspaceModuleWin && isWorkspaceModuleKind(workspaceModuleKind ?? kind)) ||
          Boolean(detachedRecord)) &&
        (input.meta || input.control) &&
        (key === '[' || key === ']');
      if (isWorkspaceHistoryShortcut) {
        event.preventDefault();
        if (detachedRecord) {
          navigateDetachedHistory(detachedRecord, key === '[' ? 'back' : 'forward');
        } else {
          navigateWorkspaceHistory(key === '[' ? 'back' : 'forward');
        }
        return;
      }

      const isF11 = key === 'f11';
      const isEscape = key === 'escape' || key === 'esc';
      if (
        (isEscape || isF11) &&
        moduleWin &&
        !moduleWin.isDestroyed() &&
        moduleWin.isFullScreen()
      ) {
        // Prevent the renderer from also handling it
        event.preventDefault();
        moduleWin.setFullScreen(false);
        moduleWin.show();
        moduleWin.focus();
      }
    } catch (err) {
      // Non-fatal — ignore
    }
  });

  // Handle renderer requests to toggle native window shadow for this window
  // Remove any previous handler before registering to avoid duplicate-registration errors
  try {
    ipcMain.removeHandler('window:set-has-shadow');
  } catch (e) {}
  ipcMain.handle('window:set-has-shadow', (event, enabled: boolean) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed() && typeof (win as any).setHasShadow === 'function') {
        (win as any).setHasShadow(Boolean(enabled));
      }
    } catch (err) {
      console.error('Failed to set window shadow:', err);
    }
    return true;
  });

  moduleWin.on('enter-full-screen', () => {
    try {
      // Ensure the window is visible and focused when entering fullscreen
      if (!moduleWin.isDestroyed()) {
        applyWindowsModuleWindowShape(moduleWin);
        if (moduleWin === workspaceModuleWin && shouldAttachWorkspaceWindowToSidebar()) {
          pauseWorkspaceDockRefresh(260);
          const sidebarBounds = getSidebarBoundsInsideFullscreenTarget(moduleWin.getBounds());
          if (sidebarBounds && setSidebarBounds(sidebarBounds, true)) {
            currentFloatingPosition = { x: sidebarBounds.x, y: sidebarBounds.y };
            currentFloatingDockBounds = moduleWin.getBounds();
          }
        }
        moduleWin.show();
        moduleWin.focus();
        if (!isDetachedWindow) {
          syncSidebarWorkspaceFullscreenLayer(kind, moduleWin);
        }
        sendModuleFullscreenState(kind, moduleWin, true);
      }
    } catch (err) {}
  });

  moduleWin.on('leave-full-screen', () => {
    try {
      if (!moduleWin.isDestroyed()) {
        applyWindowsModuleWindowShape(moduleWin);
        if (moduleWin === workspaceModuleWin && shouldAttachWorkspaceWindowToSidebar()) {
          pauseWorkspaceDockRefresh(260);
          setTimeout(() => {
            if (!workspaceModuleWin || workspaceModuleWin.isDestroyed()) return;
            if (workspaceModuleKind !== kind) return;
            setWorkspaceWindowAsFloatingDockTarget(kind);
            applyWorkspaceDockTargetBounds();
          }, 260);
        }
        moduleWin.show();
        moduleWin.focus();
        if (moduleWin === workspaceModuleWin) {
          setSidebarAboveWorkspaceWindow(false);
        }
        sendModuleFullscreenState(kind, moduleWin, false);
      }
    } catch (err) {}
  });

  if (!isQuickCapture && !isDetachedWindow) {
    const rememberBounds = () => {
      if (
        moduleWin.isDestroyed() ||
        (moduleWin === workspaceModuleWin && Boolean(workspaceShellFullscreenRestoreBounds)) ||
        moduleWindowFullscreenBoundsMemory.has(kind)
      ) {
        return;
      }
      const bounds = moduleWin.getBounds();
      moduleWindowBoundsMemory.set(kind, {
        bounds,
        sidebarPosition: currentSidebarPosition,
      });
    };
    moduleWin.on('moved', rememberBounds);
    moduleWin.on('resized', rememberBounds);
  }

  moduleWin.webContents.once('did-finish-load', () => {
    applyWindowsModuleWindowShape(moduleWin);
    moduleWin.show();
    // Delay focus to prevent sidebar from stealing focus back
    setTimeout(() => {
      if (!moduleWin.isDestroyed()) {
        moduleWin.focus();
      }
    }, 100);
    sendModuleFocus(
      kind,
      focusDate,
      focusProjectId,
      focusNoteId,
      focusTaskId,
      focusContext,
      focusSection,
      isDetachedWindow ? moduleWin : undefined
    );
    sendModuleFullscreenState(
      kind,
      moduleWin,
      (moduleWin === workspaceModuleWin && Boolean(workspaceShellFullscreenRestoreBounds)) ||
        moduleWindowFullscreenBoundsMemory.has(kind) ||
        moduleWin.isFullScreen()
    );
    if (isDetachedWindow) {
      const detachedRecord = getDetachedWindowRecord(moduleWin);
      if (detachedRecord) {
        sendWorkspaceRouteChanged(moduleWin, detachedRecord.route);
        if (options.detachedTabSession && options.detachedWindowId) {
          const transferId = options.detachedTabSession.tabId;
          const sendHydration = () => {
            const pending = pendingTabDetaches.get(transferId);
            if (!pending || pending.target !== moduleWin || moduleWin.isDestroyed()) return;
            moduleWin.webContents.send('tab:hydrate-session', {
              transferId,
              session: options.detachedTabSession,
            });
          };
          sendHydration();
          setTimeout(sendHydration, 150);
          setTimeout(sendHydration, 500);
        }
        sendNavigationStateToWindow(moduleWin);
      }
    } else if (isWorkspaceModuleKind(kind) && currentSidebarMode === 'fullscreen') {
      enterModuleWindowFullscreen(kind, moduleWin);
    }
    if (!isDetachedWindow) {
      broadcastWorkspaceNavigationState();
    }
  });
  try {
    moduleWin.loadURL(
      buildModuleUrl(workspaceRoute, {
        windowId: options.detachedWindowId ?? getLedgerWindowId(moduleWin),
        detached: isDetachedWindow,
        transferId: options.transferId,
      })
    );
  } catch (err) {
    console.error('[electron] Error while loading module renderer:', err);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || !trayState.runInBackground) {
    app.quit();
  }
});

app.on('will-quit', () => {
  isQuittingApp = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (allLedgerWindowsHidden) return;

  const workspaceWin =
    workspaceModuleWin && !workspaceModuleWin.isDestroyed() ? workspaceModuleWin : null;
  const workspaceShellCanRestore =
    workspaceWin &&
    workspaceWin.isMinimized() &&
    (workspaceSidebarMinimizedWithShell || isWorkspaceDockTarget());

  if (workspaceShellCanRestore) {
    workspaceWin.restore();
    workspaceWin.show();
    workspaceWin.focus();
    return;
  }

  if (workspaceSidebarMinimizedWithShell) {
    workspaceSidebarMinimizedWithShell = false;
  }

  if (!sidebarWin || sidebarWin.isDestroyed()) {
    createSidebarWindow();
    return;
  }

  if (!sidebarIsVisible) return;
  if (sidebarWin.isVisible()) return;

  sidebarWin.show();
  applySidebarWindowMode(currentSidebarMode);
  sidebarIsVisible = true;
  sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: true });
});

ipcMain.handle('window:set-mode', (_event, mode: SidebarWindowMode) => {
  applySidebarWindowMode(mode);
});

ipcMain.handle('window:set-visible', (_event, isVisible: boolean) => {
  applySidebarVisibility(isVisible, true);
});

ipcMain.handle('window:hide-temporary', () => {
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  sidebarWin.hide();
});

ipcMain.handle('window:quit-app', () => {
  quitLedgerApp();
});

ipcMain.handle('window:set-always-on-top', (_event, alwaysOnTop: boolean) => {
  applySidebarAlwaysOnTop(alwaysOnTop);
});

ipcMain.handle(
  'window:apply-sidebar-preferences',
  (_event, preferences: SidebarPreferencesPayload) => {
    if (!sidebarWin || sidebarWin.isDestroyed()) return;
    const previousSidebarPosition = currentSidebarPosition;
    const hasPositionChange =
      preferences.position === 'left' ||
      preferences.position === 'right' ||
      preferences.position === 'top' ||
      preferences.position === 'bottom' ||
      preferences.position === 'floating';
    const hasFloatingPositionChange = Boolean(preferences.floatingPosition);
    const hasDockToggleChange = typeof preferences.floatingDockEnabled === 'boolean';
    const hasDockThresholdChange = typeof preferences.floatingDockThreshold === 'number';
    const hasHiddenStateChange = typeof preferences.isHidden === 'boolean';
    const hasModeRelevantChange =
      hasPositionChange ||
      hasFloatingPositionChange ||
      hasDockToggleChange ||
      hasDockThresholdChange ||
      hasHiddenStateChange;

    if (
      preferences.position === 'left' ||
      preferences.position === 'right' ||
      preferences.position === 'top' ||
      preferences.position === 'bottom'
    ) {
      currentSidebarPosition = preferences.position;
      clearCurrentFloatingDockTarget();
      stopFloatingDockTracking();
    } else if (preferences.position === 'floating') {
      currentSidebarPosition = 'floating';
      if (previousSidebarPosition !== 'floating') {
        clearCurrentFloatingDockTarget();
        stopFloatingDockTracking();
      }
    }
    if (typeof preferences.opacity === 'number') {
      applySidebarOpacity(preferences.opacity);
    }
    if (typeof preferences.alwaysOnTop === 'boolean') {
      applySidebarAlwaysOnTop(preferences.alwaysOnTop);
    }
    if (typeof preferences.shellFullscreen === 'boolean') {
      currentSidebarShellFullscreen = preferences.shellFullscreen;
    }
    if (preferences.floatingPosition) {
      currentFloatingPosition = {
        x: preferences.floatingPosition.x,
        y: preferences.floatingPosition.y,
      };
      syncCurrentFloatingPosition({
        x: preferences.floatingPosition.x,
        y: preferences.floatingPosition.y,
        width: 1,
        height: 1,
      });
    }
    if (preferences.floatingDockEnabled === false) {
      clearCurrentFloatingDockTarget();
      stopFloatingDockTracking();
      // Ensure we don't keep stale dock-shaped bounds after dock is disabled.
      applySidebarWindowMode(currentSidebarMode, !hasPositionChange);
    }
    currentSidebarPreferences = {
      ...currentSidebarPreferences,
      ...preferences,
    };
    // Always send preferences update including opacity to renderer so it can
    // apply opacity only to the background glass layer via CSS variables
    sidebarWin.webContents.send('sidebar:preferences-updated', preferences);
    if (
      hasModeRelevantChange &&
      currentSidebarMode !== 'auth' &&
      currentSidebarMode !== 'fullscreen'
    ) {
      applySidebarWindowMode(currentSidebarMode, true);

      if (
        currentSidebarPosition === 'floating' &&
        currentFloatingDockTarget &&
        currentSidebarPreferences.floatingDockEnabled !== false
      ) {
        if (
          !floatingDockNativeTracker &&
          !startFloatingDockNativeTracker(currentFloatingDockTarget)
        ) {
          startFloatingDockTracking();
        }
      }
    }
  }
);

ipcMain.handle(
  'window:set-floating-position',
  (_event, floatingPosition: { x: number; y: number }) => {
    currentFloatingPosition = {
      x: floatingPosition.x,
      y: floatingPosition.y,
    };

    if (!sidebarWin || sidebarWin.isDestroyed()) return;
    if (currentSidebarPosition !== 'floating') return;
    if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return;

    sidebarWin.setPosition(floatingPosition.x, floatingPosition.y, false);
    syncCurrentFloatingPosition({
      x: floatingPosition.x,
      y: floatingPosition.y,
      width: 1,
      height: 1,
    });
  }
);

ipcMain.handle('window:begin-floating-drag', () => {
  floatingDockDragActive = true;
  clearCurrentFloatingDockTarget();
  stopFloatingDockTracking();

  // Main process owns drag deltas so Windows stays in Electron's DIP coordinate space.
  if (!sidebarWin || sidebarWin.isDestroyed()) return { x: 0, y: 0 };
  const bounds = sidebarWin.getBounds();
  floatingDragStart = {
    cursor: screen.getCursorScreenPoint(),
    bounds,
  };
  return { x: bounds.x, y: bounds.y };
});

ipcMain.handle('window:finish-floating-drag', async () => {
  floatingDockDragActive = false;
  floatingDragStart = null;

  if (!sidebarWin || sidebarWin.isDestroyed()) return null;
  if (currentSidebarPosition !== 'floating') return sidebarWin.getBounds();
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') {
    return sidebarWin.getBounds();
  }

  if (process.platform === 'win32' && currentSidebarPreferences.floatingDockEnabled !== false) {
    const dockedBounds = await dockFloatingSidebarToTarget();
    if (dockedBounds) return dockedBounds;
  }

  if (
    currentFloatingDockAttachmentStatus === 'attached' &&
    currentFloatingDockTarget &&
    currentSidebarPreferences.floatingDockEnabled !== false
  ) {
    startFloatingDockTracking();
  } else {
    stopFloatingDockTracking();
  }

  currentFloatingPosition = {
    x: sidebarWin.getBounds().x,
    y: sidebarWin.getBounds().y,
  };

  return sidebarWin.getBounds();
});

ipcMain.handle('window:update-floating-drag', () => {
  if (!sidebarWin || sidebarWin.isDestroyed()) return null;
  if (!floatingDragStart) return sidebarWin.getBounds();
  if (currentSidebarPosition !== 'floating') return sidebarWin.getBounds();
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') {
    return sidebarWin.getBounds();
  }

  const cursor = screen.getCursorScreenPoint();
  const nextPosition = {
    x: floatingDragStart.bounds.x + cursor.x - floatingDragStart.cursor.x,
    y: floatingDragStart.bounds.y + cursor.y - floatingDragStart.cursor.y,
  };

  currentFloatingPosition = nextPosition;
  sidebarWin.setPosition(nextPosition.x, nextPosition.y, false);
  return sidebarWin.getBounds();
});

ipcMain.handle('window:begin-header-drag', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  if (win.isFullScreen()) return win.getBounds();

  if (win.isMaximized()) {
    win.unmaximize();
  }

  if (win === workspaceModuleWin && isLedgerWindowDockTarget()) {
    cancelSidebarBoundsAnimation();
    cancelWorkspaceDockRefresh();
  }

  const bounds = win.getBounds();
  stopHeaderDragLoop(event.sender.id);
  headerDragStarts.set(event.sender.id, {
    cursor: screen.getCursorScreenPoint(),
    bounds,
    timer: null,
    lastPosition: { x: bounds.x, y: bounds.y },
    sidebarLastPosition:
      win === workspaceModuleWin &&
      isLedgerWindowDockTarget() &&
      sidebarWin &&
      !sidebarWin.isDestroyed()
        ? { x: sidebarWin.getBounds().x, y: sidebarWin.getBounds().y }
        : undefined,
  });
  startHeaderDragLoop(event.sender.id, win);
  return bounds;
});

ipcMain.handle('window:update-header-drag', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  const dragStart = headerDragStarts.get(event.sender.id);
  if (!dragStart) return win.getBounds();
  if (win.isFullScreen()) return win.getBounds();

  applyHeaderDragPosition(event.sender.id, win);
  return win.getBounds();
});

ipcMain.handle('window:finish-header-drag', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  stopHeaderDragLoop(event.sender.id);
  headerDragStarts.delete(event.sender.id);
  if (!win || win.isDestroyed()) return null;
  applyWindowsModuleWindowShape(win);
  if (win === workspaceModuleWin && isLedgerWindowDockTarget()) {
    currentFloatingDockBounds = win.getBounds();
    currentFloatingDockDisplayId = getDisplayForBounds(currentFloatingDockBounds).id;
    applyWorkspaceDockTargetBounds(win.getBounds());
  }
  return win.getBounds();
});

ipcMain.handle('window:dock-floating-window', async () => {
  floatingDragStart = null;
  return dockFloatingSidebarToTarget();
});

ipcMain.handle('window:detach-floating-window', () => {
  floatingDockDragActive = false;
  floatingDragStart = null;
  clearCurrentFloatingDockTarget();
  stopFloatingDockTracking();
  return null;
});

ipcMain.handle('window:floating-dock-state', () => {
  return getFloatingDockStatePayload();
});

ipcMain.handle('window:open-search-in-workspace-window', (event, query = '') => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow !== sidebarWin || !isLedgerWindowDockTarget()) return false;
  if (!workspaceModuleWin || workspaceModuleWin.isDestroyed()) return false;

  workspaceModuleWin.show();
  workspaceModuleWin.focus();
  workspaceModuleWin.webContents.send('search:open', { query: String(query ?? '') });
  return true;
});

ipcMain.handle('window:toggle-module', (event, payload: ModuleWindowKind | ModuleFocusPayload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const detachedRecord = getDetachedWindowRecord(senderWindow);
  const kind = typeof payload === 'string' ? payload : payload.kind;
  const focusDate = typeof payload === 'string' ? undefined : payload.focusDate;
  const focusProjectId = typeof payload === 'string' ? undefined : payload.focusProjectId;
  const focusNoteId = typeof payload === 'string' ? undefined : payload.focusNoteId;
  const focusTaskId = typeof payload === 'string' ? undefined : payload.focusTaskId;
  const focusContext = typeof payload === 'string' ? undefined : payload.focusContext;
  const focusSection = typeof payload === 'string' ? undefined : payload.focusSection;
  if (detachedRecord) {
    if (typeof payload !== 'string') {
      navigateDetachedWindow(
        detachedRecord,
        routeFromModuleArgs(
          kind,
          focusDate,
          focusProjectId,
          focusNoteId,
          focusTaskId,
          focusContext,
          focusSection
        )
      );
    } else if (senderWindow?.isVisible()) {
      senderWindow.minimize();
    } else {
      senderWindow?.show();
      senderWindow?.focus();
    }
    return;
  }
  const existing = moduleWins.get(kind);

  if (existing && !existing.isDestroyed()) {
    if (focusDate || focusProjectId || focusNoteId || focusTaskId) {
      if (existing.isMinimized()) {
        existing.restore();
        if (isWorkspaceModuleKind(kind)) {
          restoreSidebarAfterWorkspaceShellMinimize();
          setWorkspaceWindowAsFloatingDockTarget(kind);
        }
      }
      existing.show();
      existing.focus();
      sendModuleFocus(
        kind,
        focusDate,
        focusProjectId,
        focusNoteId,
        focusTaskId,
        focusContext,
        focusSection
      );
      return;
    }

    if (existing.isMinimized()) {
      existing.restore();
      if (isWorkspaceModuleKind(kind)) {
        restoreSidebarAfterWorkspaceShellMinimize();
        setWorkspaceWindowAsFloatingDockTarget(kind);
      }
      existing.focus();
      return;
    }

    if (existing.isVisible()) {
      existing.minimize();
      return;
    }

    existing.show();
    existing.focus();
    return;
  }

  openModuleWindow(
    kind,
    focusDate,
    focusProjectId,
    focusNoteId,
    focusTaskId,
    focusContext,
    focusSection
  );
});

ipcMain.handle('window:open-module', (event, payload: ModuleWindowKind | ModuleFocusPayload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const detachedRecord = getDetachedWindowRecord(senderWindow);
  const kind = typeof payload === 'string' ? payload : payload.kind;
  const focusDate = typeof payload === 'string' ? undefined : payload.focusDate;
  const focusProjectId = typeof payload === 'string' ? undefined : payload.focusProjectId;
  const focusNoteId = typeof payload === 'string' ? undefined : payload.focusNoteId;
  const focusTaskId = typeof payload === 'string' ? undefined : payload.focusTaskId;
  const focusContext = typeof payload === 'string' ? undefined : payload.focusContext;
  const focusSection = typeof payload === 'string' ? undefined : payload.focusSection;
  if (detachedRecord) {
    navigateDetachedWindow(
      detachedRecord,
      routeFromModuleArgs(
        kind,
        focusDate,
        focusProjectId,
        focusNoteId,
        focusTaskId,
        focusContext,
        focusSection
      )
    );
    senderWindow?.show();
    senderWindow?.focus();
    return;
  }
  const existing = moduleWins.get(kind);

  if (existing && !existing.isDestroyed()) {
    // A tab activation can switch the shared Ledger window to another
    // module without creating a BrowserWindow. Keep the window-level route
    // authority in sync with the content that is being focused.
    if (existing === workspaceModuleWin && typeof payload !== 'string') {
      navigateWorkspaceModuleWindow(
        routeFromModuleArgs(
          kind,
          focusDate,
          focusProjectId,
          focusNoteId,
          focusTaskId,
          focusContext,
          focusSection
        )
      );
      return;
    }

    if (existing.isMinimized()) {
      existing.restore();
      if (existing === workspaceModuleWin) {
        restoreSidebarAfterWorkspaceShellMinimize();
      }
    }
    existing.show();
    // Delay focus slightly to prevent sidebar from stealing focus back
    setTimeout(() => {
      if (!existing.isDestroyed()) {
        existing.focus();
      }
    }, 100);
    sendModuleFocus(
      kind,
      focusDate,
      focusProjectId,
      focusNoteId,
      focusTaskId,
      focusContext,
      focusSection
    );
    return;
  }

  openModuleWindow(
    kind,
    focusDate,
    focusProjectId,
    focusNoteId,
    focusTaskId,
    focusContext,
    focusSection
  );
});

ipcMain.handle('window:close-module', (event, kind: ModuleWindowKind) => {
  const detachedRecord = getDetachedWindowRecord(BrowserWindow.fromWebContents(event.sender));
  if (detachedRecord) {
    detachedRecord.win.close();
    return;
  }
  const existing = moduleWins.get(kind);
  if (!existing || existing.isDestroyed()) return;
  existing.close();
});

ipcMain.handle('window:minimize-module', (event, kind: ModuleWindowKind) => {
  const detachedRecord = getDetachedWindowRecord(BrowserWindow.fromWebContents(event.sender));
  if (detachedRecord) {
    detachedRecord.win.minimize();
    return;
  }
  const existing = moduleWins.get(kind);
  if (!existing || existing.isDestroyed()) return;
  suspendCurrentFloatingDockTarget('suspended_minimized');
  existing.minimize();
  if (existing === workspaceModuleWin && isWorkspaceDockTarget()) {
    minimizeSidebarWithWorkspaceShell();
  }
});

ipcMain.handle('window:toggle-module-fullscreen', (event, kind: ModuleWindowKind) => {
  const detachedRecord = getDetachedWindowRecord(BrowserWindow.fromWebContents(event.sender));
  if (detachedRecord) {
    if (detachedRecord.win.isFullScreen()) {
      detachedRecord.win.setFullScreen(false);
      return false;
    }
    detachedRecord.win.setFullScreen(true);
    return true;
  }
  const existing = moduleWins.get(kind);
  if (!existing || existing.isDestroyed()) return false;
  if (existing.isMinimized()) {
    existing.restore();
    if (existing === workspaceModuleWin) {
      restoreSidebarAfterWorkspaceShellMinimize();
    }
  }
  const isPseudoFullscreen = moduleWindowFullscreenBoundsMemory.has(kind);
  const isWorkspacePseudoFullscreen =
    existing === workspaceModuleWin && Boolean(workspaceShellFullscreenRestoreBounds);
  const isNativeFullscreen = existing.isFullScreen();

  if (!isPseudoFullscreen && !isWorkspacePseudoFullscreen && !isNativeFullscreen) {
    enterModuleWindowFullscreen(kind, existing);
    return true;
  }

  if (isNativeFullscreen) {
    existing.setFullScreen(false);
  }
  restoreModuleWindowBounds(kind, existing);
  sendModuleFullscreenState(kind, existing, false);
  return false;
});

ipcMain.handle('window:workspace-go-back', (event) => {
  const detachedRecord = getDetachedWindowRecord(BrowserWindow.fromWebContents(event.sender));
  if (detachedRecord) {
    navigateDetachedHistory(detachedRecord, 'back');
    return;
  }
  navigateWorkspaceHistory('back');
});

ipcMain.handle('window:workspace-go-forward', (event) => {
  const detachedRecord = getDetachedWindowRecord(BrowserWindow.fromWebContents(event.sender));
  if (detachedRecord) {
    navigateDetachedHistory(detachedRecord, 'forward');
    return;
  }
  navigateWorkspaceHistory('forward');
});

ipcMain.handle('window:workspace-navigation-state', (event) => {
  return getNavigationStateForWindow(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.handle('window:workspace-route-changed', (event, payload: ModuleFocusPayload) => {
  const kind = payload?.kind;
  if (!kind) return false;
  const detachedRecord = getDetachedWindowRecord(BrowserWindow.fromWebContents(event.sender));
  if (detachedRecord) {
    return navigateDetachedWindow(
      detachedRecord,
      routeFromModuleArgs(
        kind,
        payload.focusDate,
        payload.focusProjectId,
        payload.focusNoteId,
        payload.focusTaskId,
        payload.focusContext,
        payload.focusSection
      )
    );
  }
  return updateWorkspaceModuleRoute(
    routeFromModuleArgs(
      kind,
      payload.focusDate,
      payload.focusProjectId,
      payload.focusNoteId,
      payload.focusTaskId,
      payload.focusContext,
      payload.focusSection
    )
  );
});

function isValidDetachedTabSession(value: unknown): value is DetachedTabSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<DetachedTabSession>;
  if (typeof session.tabId !== 'string' || session.tabId.length > 200) return false;
  if (typeof session.module !== 'string' || !isWorkspaceModuleKind(session.module)) return false;
  if (!session.route || typeof session.route !== 'object') return false;
  if (session.route.kind !== session.module || !isWorkspaceModuleKind(session.route.kind)) {
    return false;
  }
  if (!Array.isArray(session.tabHistory) || session.tabHistory.length > 100) return false;
  return session.tabHistory.every(
    (route) => route && typeof route === 'object' && isWorkspaceModuleKind(route.kind)
  );
}

ipcMain.handle('window:get-bounds', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  return { ...win.getBounds(), windowId: getLedgerWindowId(win) };
});

ipcMain.handle(
  'window:detach-tab',
  async (event, payload: { session?: unknown; screenPoint?: { x?: number; y?: number } }) => {
    const source = BrowserWindow.fromWebContents(event.sender);
    const session = payload?.session;
    if (!source || source.isDestroyed() || !isValidDetachedTabSession(session)) {
      return { success: false };
    }

    const point = {
      x: Number(payload?.screenPoint?.x),
      y: Number(payload?.screenPoint?.y),
    };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { success: false };

    const display = screen.getDisplayNearestPoint(point);
    const workArea = display.workArea;
    const width = Math.min(1050, Math.max(MODULE_MIN_WIDTH, workArea.width - WINDOW_MARGIN * 2));
    const height = Math.min(720, Math.max(MODULE_MIN_HEIGHT, workArea.height - WINDOW_MARGIN * 2));
    const initialBounds = clampRectToWorkArea(
      {
        x: Math.round(point.x - width / 2),
        y: Math.round(point.y - 24),
        width,
        height,
      },
      workArea
    );
    const detachedWindowId = `ledger-window-${randomUUID()}`;
    const transferId = randomUUID();

    const success = await new Promise<boolean>((resolve) => {
      pendingTabDetaches.set(transferId, {
        source,
        target: null,
        session: { ...session, tabId: transferId },
        resolve,
      });
      try {
        openModuleWindow(
          session.module,
          session.route.focusDate,
          session.route.focusProjectId,
          session.route.focusNoteId,
          session.route.focusTaskId,
          session.route.focusContext,
          session.route.focusSection,
          {
            detachedWindowId,
            initialBounds,
            detachedTabSession: { ...session, tabId: transferId },
            transferId,
          }
        );
        const record = detachedWindows.get(detachedWindowId);
        const pending = pendingTabDetaches.get(transferId);
        if (!record || !pending) {
          pendingTabDetaches.delete(transferId);
          resolve(false);
          return;
        }
        pending.target = record.win;
        setTimeout(() => {
          const stillPending = pendingTabDetaches.get(transferId);
          if (!stillPending) return;
          pendingTabDetaches.delete(transferId);
          if (record.win && !record.win.isDestroyed()) record.win.close();
          resolve(false);
        }, 15000);
      } catch {
        pendingTabDetaches.delete(transferId);
        resolve(false);
      }
    });

    return { success };
  }
);

ipcMain.handle('window:confirm-tab-detach', (event, transferId: unknown) => {
  if (typeof transferId !== 'string') return false;
  const target = BrowserWindow.fromWebContents(event.sender);
  const pending = pendingTabDetaches.get(transferId);
  if (!target || !pending || pending.target !== target) return false;
  pendingTabDetaches.delete(transferId);
  pending.resolve(true);
  return true;
});

ipcMain.handle('window:get-tab-detach-session', (event, transferId: unknown) => {
  if (typeof transferId !== 'string') return null;
  const target = BrowserWindow.fromWebContents(event.sender);
  const pending = pendingTabDetaches.get(transferId);
  if (!target || !pending || pending.target !== target) return null;
  return pending.session;
});

ipcMain.handle('window:open-external', async (_event, url: string) => {
  if (!/^https?:\/\//i.test(url) && !/^webcal:\/\//i.test(url)) {
    throw new Error('Unsupported external URL protocol');
  }
  await shell.openExternal(url);
});

ipcMain.handle('window:open-checkin', () => {
  applySidebarVisibility(true, true);
  applySidebarWindowMode('expanded');
  if (sidebarWin && !sidebarWin.isDestroyed()) {
    sidebarWin.webContents.send('sidebar:state-changed', { state: 'expanded' });
    // ExpandedSidebar may mount a moment after switching from rail/compact.
    // Send immediately and once more after mount to avoid dropping the signal.
    sidebarWin.webContents.send('sidebar:open-checkin');
    setTimeout(() => {
      if (!sidebarWin || sidebarWin.isDestroyed()) return;
      sidebarWin.webContents.send('sidebar:state-changed', { state: 'expanded' });
      sidebarWin.webContents.send('sidebar:open-checkin');
    }, 220);
  }
});

ipcMain.handle(
  'spellcheck:autocorrect-note',
  async (_event, payload: { title?: string; content_html?: string }) => {
    const spellchecker = await getSpellchecker();
    const correctedTitle = correctTextWithSpellchecker(spellchecker, String(payload?.title ?? ''));
    const correctedHtml = await correctHtmlWithSpellchecker(
      spellchecker,
      String(payload?.content_html ?? '')
    );
    return {
      title: correctedTitle.text,
      content_html: correctedHtml.html,
      count: correctedTitle.count + correctedHtml.count,
    } satisfies SpellcheckAutocorrectResult;
  }
);

ipcMain.on(
  'daily:checkin-updated',
  (_event, payload: { finished?: string; blocked?: string; firstTaskTomorrow?: string }) => {
    const dashboardWin = moduleWins.get('dashboard');
    if (!dashboardWin || dashboardWin.isDestroyed()) return;
    dashboardWin.webContents.send('daily:checkin-updated', payload);
  }
);

ipcMain.on(
  'dashboard:today-task-created',
  (
    _event,
    payload: {
      source?: string;
      client_id?: string;
      optimistic?: boolean;
      rollback?: boolean;
      task?: {
        id?: string;
        title?: string;
        workspace_id?: string | null;
        workspace_name?: string | null;
        workspace_color?: string | null;
        is_today_focus?: boolean;
        show_in_today?: boolean;
        due_date?: string | null;
        due_time?: string | null;
        created_at?: string | null;
      };
    }
  ) => {
    const dashboardWin = moduleWins.get('dashboard');
    if (!dashboardWin || dashboardWin.isDestroyed()) return;
    dashboardWin.webContents.send('dashboard:today-task-created', payload);
  }
);

ipcMain.on(
  'dashboard:today-task-deleted',
  (
    _event,
    payload: {
      source?: string;
      client_id?: string;
      optimistic?: boolean;
      rollback?: boolean;
      task?: {
        id?: string;
        title?: string;
        workspace_id?: string | null;
        workspace_name?: string | null;
        workspace_color?: string | null;
        is_today_focus?: boolean;
        show_in_today?: boolean;
        due_date?: string | null;
        due_time?: string | null;
        created_at?: string | null;
      };
    }
  ) => {
    const dashboardWin = moduleWins.get('dashboard');
    if (!dashboardWin || dashboardWin.isDestroyed()) return;
    dashboardWin.webContents.send('dashboard:today-task-deleted', payload);
  }
);

ipcMain.on(
  'calendar:follow-up-created',
  (_event, payload: { eventId?: string; eventTitle?: string; task?: unknown }) => {
    const calendarWin = moduleWins.get('calendar');
    if (!calendarWin || calendarWin.isDestroyed()) return;
    calendarWin.webContents.send('calendar:follow-up-created', payload);
  }
);

ipcMain.on('calendar:items-updated', () => {
  broadcastCalendarItemsUpdated();
});

ipcMain.on('notes:smart-links-updated', (_event, payload: { noteId?: string | null } | null) => {
  broadcastNotesSmartLinksUpdated(payload ?? null);
});

ipcMain.on(
  'ledger:theme-updated',
  (_event, payload: { theme?: 'light' | 'dark' | 'system' } | null) => {
    const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
    for (const win of windows) {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send('ledger:theme-updated', payload ?? null);
      }
    }
  }
);

// Touch Bar setup for macOS
function syncTouchBar() {
  if (process.platform !== 'darwin' || !sidebarWin || sidebarWin.isDestroyed()) return;

  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') {
    sidebarWin.setTouchBar(null);
    return;
  }

  const { TouchBarButton, TouchBarSpacer } = TouchBar;

  if (!sidebarTouchBar) {
    sidebarTouchBar = new TouchBar({
      items: [
        new TouchBarButton({
          label: '+ Task',
          backgroundColor: '#FF5F40',
          click: () => {
            console.log('[touchbar] Opening quick-task');
            openModuleWindow('quick-task');
          },
        }),
        new TouchBarButton({
          label: '+ Note',
          backgroundColor: '#FF5F40',
          click: () => {
            console.log('[touchbar] Opening quick-note');
            openModuleWindow('quick-note');
          },
        }),
        new TouchBarButton({
          label: '+ Event',
          backgroundColor: '#FF5F40',
          click: () => {
            console.log('[touchbar] Opening quick-event');
            openModuleWindow('quick-event');
          },
        }),
        new TouchBarSpacer({ size: 'small' }),
        new TouchBarButton({
          label: 'Search',
          backgroundColor: '#FF5F40',
          click: () => {
            sidebarWin?.webContents.send('touchbar:open-search');
          },
        }),
      ],
    });
  }

  sidebarWin.setTouchBar(sidebarTouchBar);
}

app.whenReady().then(() => {
  loadNotificationDeliveryState();
  registerLedgerProtocol();
  // A remembered module window may refer to a display that was disconnected
  // or whose work area changed. Reconcile open module windows against the
  // current display layout without touching the sidebar's docking geometry.
  screen.on('display-removed', clampOpenModuleWindowsToDisplays);
  screen.on('display-metrics-changed', clampOpenModuleWindowsToDisplays);
  createSidebarWindow();
  syncTray();
  processPendingLedgerProtocolUrl();
  ipcMain.on(
    'tray:update-state',
    (
      _event,
      payload?: {
        showTrayIcon?: boolean;
        runInBackground?: boolean;
        inboxCount?: number;
        notificationCount?: number;
        notificationsPaused?: boolean;
      }
    ) => {
      if (!payload) return;
      updateTrayState({
        ...(typeof payload.showTrayIcon === 'boolean'
          ? { showTrayIcon: payload.showTrayIcon }
          : {}),
        ...(typeof payload.runInBackground === 'boolean'
          ? { runInBackground: payload.runInBackground }
          : {}),
        ...(typeof payload.inboxCount === 'number' && Number.isFinite(payload.inboxCount)
          ? { inboxCount: Math.max(0, Math.floor(payload.inboxCount)) }
          : {}),
        ...(typeof payload.notificationCount === 'number' &&
        Number.isFinite(payload.notificationCount)
          ? { notificationCount: Math.max(0, Math.floor(payload.notificationCount)) }
          : {}),
        ...(typeof payload.notificationsPaused === 'boolean'
          ? { notificationsPaused: payload.notificationsPaused }
          : {}),
      });
    }
  );
  ipcMain.on(
    'notifications:set-session',
    (
      _event,
      payload?: { accessToken?: string | null; userId?: string | null; apiUrl?: string | null }
    ) => {
      syncNotificationSession(payload ?? null);
    }
  );
  ipcMain.on('notifications:refresh', () => {
    queueNotificationSchedulerRun(NOTIFICATION_SCHEDULER_REFRESH_MIN_DELAY_MS);
  });

  // Setup Touch Bar for macOS
  setTimeout(() => syncTouchBar(), 500);

  notificationSchedulerTimer = setInterval(() => {
    queueNotificationSchedulerRun(0);
  }, NOTIFICATION_SCHEDULER_INTERVAL_MS);

  const toggleSidebarShortcut = process.platform === 'darwin' ? 'Cmd+Shift+B' : 'Ctrl+Shift+B';
  const registered = globalShortcut.register(toggleSidebarShortcut, () => {
    const now = Date.now();
    if (now - lastSidebarToggleAt < 250) return;
    lastSidebarToggleAt = now;
    const nextVisible = sidebarWin && !sidebarWin.isDestroyed() ? !sidebarIsVisible : false;
    applySidebarVisibility(nextVisible, true);
  });

  if (!registered) {
    console.warn(`[electron] Failed to register sidebar shortcut: ${toggleSidebarShortcut}`);
  }

  const toggleAllWindowsShortcut = process.platform === 'darwin' ? 'Cmd+Shift+L' : 'Ctrl+Shift+L';
  const allWindowsRegistered = globalShortcut.register(toggleAllWindowsShortcut, () => {
    const now = Date.now();
    if (now - lastSidebarToggleAt < 250) return;
    lastSidebarToggleAt = now;
    toggleAllLedgerWindowsVisibility();
  });

  if (!allWindowsRegistered) {
    console.warn(`[electron] Failed to register all windows shortcut: ${toggleAllWindowsShortcut}`);
  }
});

app.on('before-quit', () => {
  isQuittingApp = true;
  if (notificationSchedulerTimer !== null) {
    clearInterval(notificationSchedulerTimer);
    notificationSchedulerTimer = null;
  }
});
