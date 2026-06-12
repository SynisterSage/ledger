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
} from 'electron';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
          supabasePublishableKeyMatch?.[1]?.trim() ||
          supabaseAnonKeyMatch?.[1]?.trim() ||
          null,
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
  process.env.VITE_API_URL?.trim() || runtimeConfigValues.apiUrl || 'https://api.ledgerworkspace.com';

const isSettingsSection = (value: string | null | undefined): value is string =>
  SETTINGS_SECTIONS.has(String(value ?? '').toLowerCase());

const extractLedgerProtocolUrl = (argv: string[]) =>
  argv.find((value) => String(value ?? '').toLowerCase().startsWith(`${LEDGER_PROTOCOL}://`)) ??
  null;

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

const handleLedgerProtocolUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${LEDGER_PROTOCOL}:`) return;

    const host = parsed.hostname.toLowerCase();
    const pathnameParts = parsed.pathname.split('/').filter(Boolean);
    const sectionCandidate =
      host === 'settings' ? pathnameParts[0] : pathnameParts[0] === 'settings' ? pathnameParts[1] : null;
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
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'dashboard'
  | 'notifications'
  | 'settings'
  | 'inbox'
  | 'quick-task'
  | 'quick-note'
  | 'quick-event';
type ModuleFocusPayload = {
  kind: ModuleWindowKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
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
let currentSidebarMode: SidebarWindowMode = 'auth';
let currentSidebarPosition: SidebarPosition = 'right';
let currentFloatingPosition = { ...defaultSidebarPreferences.floatingPosition };
let currentSidebarPreferences = { ...defaultSidebarPreferences };
let currentFloatingDockTarget: FloatingDockTarget | null = null;
let currentFloatingDockBounds: Rect | null = null;
let currentFloatingDockAttachmentStatus: FloatingDockAttachmentStatus = 'detached';
let currentFloatingDockMisses = 0;
let currentFloatingDockDisplayId: number | null = null;
let floatingDockHoldUntil = 0;
let floatingDockDragActive = false;
let floatingDockTrackingTimer: NodeJS.Timeout | null = null;
let floatingDockNativeTracker: ChildProcessWithoutNullStreams | null = null;
let floatingDockNativeBuffer = '';
let windowsNativeDockRequeryAt = 0;
let floatingDragStart:
  | {
      cursor: Electron.Point;
      bounds: Electron.Rectangle;
    }
  | null = null;
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

const WINDOW_MARGIN = 16;
const RAIL_SIZE = 64;
const COLLAPSED_SIZE = 64;
const EXPANDED_WIDTH = 320;
const HORIZONTAL_DOCK_WIDTH = 1120;
const HORIZONTAL_DOCK_HEIGHT = 144;
const HORIZONTAL_COLLAPSED_WIDTH = 1120;
const HORIZONTAL_COLLAPSED_HEIGHT = 60;
const FLOATING_EXPANDED_HEIGHT = 760;
const FLOATING_RAIL_HEIGHT = 520;
const MIN_DOCK_HEIGHT = {
  expanded: 640,
  compact: 480,
  minimized: 480,
} as const;
const DASHBOARD_WIDTH = 1280;
const DASHBOARD_HEIGHT = 860;
const AUTH_WIDTH = 1040;
const AUTH_HEIGHT = 700;
const MODULE_DEFAULT_WIDTH = 1440;
const MODULE_DEFAULT_HEIGHT = 860;
const MODULE_MIN_WIDTH = 1100;
const MODULE_MIN_HEIGHT = 720;
const INBOX_DEFAULT_WIDTH = 960;
const INBOX_DEFAULT_HEIGHT = 720;
const INBOX_MIN_WIDTH = 860;
const INBOX_MIN_HEIGHT = 620;
const NOTIFICATION_CENTER_WIDTH = 480;
const NOTIFICATION_CENTER_HEIGHT = 680;
const NOTIFICATION_CENTER_MIN_WIDTH = 420;
const NOTIFICATION_CENTER_MIN_HEIGHT = 600;
const QUICK_CAPTURE_WIDTH = 400;
const QUICK_CAPTURE_HEIGHT = 320;
const MODULE_GAP = 12;
const NOTIFICATION_SCHEDULER_INTERVAL_MS = 60_000;
const NOTIFICATION_PREFS_REFRESH_MS = 5 * 60_000;
const NOTIFICATION_SCHEDULER_BACKOFF_MS = 90_000;

type NotificationSchedulerItem = {
  id: string;
  sourceType: 'reminder' | 'event' | 'task' | 'project' | 'inbox';
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
    const parsed = JSON.parse(raw) as { namespaces?: Record<string, Record<string, number>> } | null;
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

  const next = Object.fromEntries(entries.sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 2000));
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
  trayState.inboxCount > 0 ? `Open Inbox (${trayState.inboxCount})` : 'Open Inbox';

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
      return 'Inbox capture';
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
    const subtitle = [item.context?.trim(), item.workspaceName?.trim()].filter(Boolean).join(' · ') || undefined;
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

const fetchLedgerApi = async <T,>(
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
    };
    requestError.status = response.status;
    throw requestError;
  }

  return response.json() as Promise<T>;
};

const shouldRefreshNotificationPreferences = () =>
  !cachedNotificationPreferences ||
  Date.now() - cachedNotificationPreferencesAt > NOTIFICATION_PREFS_REFRESH_MS;

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
      const currentNamespace = getNotificationNamespace(notificationApiUrl, notificationSessionUserId);
      if (currentNamespace && notificationSeenIdsLoadedNamespace !== currentNamespace) {
        hydrateNotificationSeenIds(currentNamespace);
      }
      const batchKeys = new Set<string>();
      const unseenItems = activeItems.filter((item) => {
        if (notificationSeenIds.has(item.id)) return false;
        const batchKey = [
          item.sourceType,
          item.sourceId,
          item.notificationType,
        ].join(':');
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
  } catch (error) {
    if (typeof (error as { status?: number } | null)?.status === 'number' && (error as { status?: number }).status === 429) {
      notificationSchedulerCooldownUntil = Date.now() + NOTIFICATION_SCHEDULER_BACKOFF_MS;
      console.warn(
        `[electron] Notification scheduler backed off for ${NOTIFICATION_SCHEDULER_BACKOFF_MS}ms after 429`
      );
      return;
    }
    console.warn('[electron] Notification scheduler failed', error);
  } finally {
    notificationSchedulerInFlight = false;
  }
};

const syncNotificationSession = (payload: {
  accessToken?: string | null;
  userId?: string | null;
  apiUrl?: string | null;
} | null) => {
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
  if (sessionChanged || Date.now() - notificationSchedulerLastRunAt > NOTIFICATION_SCHEDULER_INTERVAL_MS) {
    void runNotificationScheduler();
  }
};

const broadcastCalendarItemsUpdated = () => {
  const targets = [sidebarWin, moduleWins.get('calendar'), moduleWins.get('dashboard')];
  for (const win of targets) {
    if (!win || win.isDestroyed()) continue;
    win.webContents.send('calendar:items-updated');
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

const buildRoundedWindowShape = (width: number, height: number, radius: number): Electron.Rectangle[] => {
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

function getDockedBounds(
  width: number,
  position: SidebarPosition = currentSidebarPosition
) {
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
    const dockY =
      position === 'top' ? y + WINDOW_MARGIN : y + workHeight - height - WINDOW_MARGIN;

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

function getCollapsedBounds(
  size: number,
  position: SidebarPosition = currentSidebarPosition
) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea;
  const safeSize = Math.min(size, workWidth - WINDOW_MARGIN * 2, workHeight - WINDOW_MARGIN * 2);

  if (position === 'top' || position === 'bottom') {
    const width = Math.min(HORIZONTAL_COLLAPSED_WIDTH, workWidth - WINDOW_MARGIN * 2);
    const height = Math.min(HORIZONTAL_COLLAPSED_HEIGHT, workHeight - WINDOW_MARGIN * 2);
    const dockY =
      position === 'top' ? y + WINDOW_MARGIN : y + workHeight - height - WINDOW_MARGIN;

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

  const display = screen.getDisplayNearestPoint(currentFloatingPosition);
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
    x: currentFloatingPosition.x,
    y: currentFloatingPosition.y,
    width,
    height,
  });

  return clampRectToWorkArea(
    {
      x: currentFloatingPosition.x,
      y: currentFloatingPosition.y,
      width,
      height,
    },
    displayForRect.workArea
  );
}

function isPrimaryDisplayBounds(bounds: Electron.Rectangle | Rect) {
  return getDisplayForBounds(bounds as Rect).id === screen.getPrimaryDisplay().id;
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
    const distance =
      (physicalCenterX - rectCenterX) ** 2 + (physicalCenterY - rectCenterY) ** 2;

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
      { windowsHide: true, timeout: 1200 }
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
    centerX < workArea.x ||
    centerX > workRight ||
    centerY < workArea.y ||
    centerY > workBottom;
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

function restoreModuleWindowBounds(kind: ModuleWindowKind, win: BrowserWindow) {
  const restoredBounds = moduleWindowFullscreenBoundsMemory.get(kind);
  if (restoredBounds) {
    const workArea = screen.getDisplayMatching(restoredBounds).workArea;
    win.setBounds(clampRectToWorkArea(restoredBounds, workArea), false);
    moduleWindowFullscreenBoundsMemory.delete(kind);
  }
  win.show();
  win.focus();
}

function enterModuleWindowFullscreen(kind: ModuleWindowKind, win: BrowserWindow) {
  if (moduleWindowFullscreenBoundsMemory.has(kind)) return;
  const workArea = getFullscreenWorkAreaForWindow(win);
  moduleWindowFullscreenBoundsMemory.set(kind, win.getBounds());
  win.setBounds(clampRectToWorkArea({ ...workArea }, workArea), false);
  win.show();
  win.focus();
}

function getDockSide(currentBounds: Rect, targetBounds: Rect): DockSide {
  const leftDistance = Math.abs(currentBounds.x - (targetBounds.x - currentBounds.width));
  const rightDistance = Math.abs(currentBounds.x - (targetBounds.x + targetBounds.width));
  return leftDistance <= rightDistance ? 'left' : 'right';
}

function getHorizontalGapBetweenRects(a: Rect, b: Rect) {
  const aRight = a.x + a.width;
  const bRight = b.x + b.width;
  if (aRight < b.x) return b.x - aRight;
  if (bRight < a.x) return a.x - bRight;
  return 0;
}

function getDockedBoundsForTarget(targetBounds: Rect, side: DockSide, mode: SidebarWindowMode) {
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
  return clampRectToWorkArea(
    { x, y, width, height },
    targetDisplay.workArea
  );
}

function sendFloatingDockChanged(
  isDocked: boolean,
  attachmentStatus: FloatingDockAttachmentStatus = isDocked ? 'attached' : 'detached'
) {
  currentFloatingDockAttachmentStatus = attachmentStatus;
  try {
    if (sidebarWin && !sidebarWin.isDestroyed() && !sidebarWin.webContents.isDestroyed()) {
      sidebarWin.webContents.send('sidebar:floating-dock-changed', {
        isDocked,
        attachmentStatus,
      });
    }
  } catch {
    // The window can be torn down between the destroyed check and the send.
  }
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
  if (!macDockHelper || macDockHelper.killed) return;
  try {
    macDockHelper.stdin.write(JSON.stringify({ kind: 'stop' }) + '\n');
  } catch {}
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
  if (!helper || helper.killed) return Promise.resolve(null);

  const requestId = ++macDockHelperRequestId;
  const message = { ...payload, requestId };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      macDockHelperRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);

    macDockHelperRequests.set(requestId, { resolve, reject, timeout });

    try {
      helper.stdin.write(JSON.stringify(message) + '\n');
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

  const writeSkippedTrace = (
    reason: string,
    details: Record<string, unknown> = {}
  ) => {
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
    currentSidebarMode
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

public static class LedgerDockTracker {
  private const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
  private const uint EVENT_SYSTEM_MINIMIZESTART = 0x0016;
  private const uint WINEVENT_OUTOFCONTEXT = 0;
  private static IntPtr targetHwnd;
  private static WinEventDelegate callbackRef = Callback;
  private static System.Timers.Timer pollTimer;

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

  private static bool TryGetWindowBounds(IntPtr hwnd, out RECT rect) {
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(RECT))) == 0) {
      return true;
    }
    return GetWindowRect(hwnd, out rect);
  }

  public static void EnableDpiAwareness() {
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4));
    } catch {}
  }

  public static void Start(long hwndValue) {
    targetHwnd = new IntPtr(hwndValue);
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

  private static void Callback(
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

  private static void EmitBounds() {
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

  private static bool IsFullscreenLike(RECT rect) {
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
[LedgerDockTracker]::EnableDpiAwareness()
[LedgerDockTracker]::Start([Int64]${target.id})
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
    if (currentFloatingDockTarget?.platform === 'win32' && currentFloatingDockTarget.id === target.id) {
      dockLog(`[dock-debug] Windows native dock tracker exited for ${target.id}; falling back to polling`);
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
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  if (currentSidebarPosition !== 'floating') return;
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return;
  if (floatingDockDragActive) return;
  if (!currentSidebarPreferences.floatingDockEnabled) return;
  if (!currentFloatingDockTarget) return;

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
}

async function getFloatingDockTargetAtCursor(): Promise<DockTargetResult | null> {
  try {
    const sidebarBounds = sidebarWin?.getBounds();
    if (!sidebarBounds) return null;
    const threshold = currentSidebarPreferences.floatingDockThreshold;
    const isPrimaryDisplay = isPrimaryDisplayBounds(sidebarBounds);
    const snapDistance =
      process.platform === 'win32'
        ? Math.max(isPrimaryDisplay ? 12 : 8, Math.floor(threshold * (isPrimaryDisplay ? 3 : 2)))
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
          timeout: 1200,
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
}
"@
try { [Win32]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
$sidebarLeft = ${Math.floor(nativeSidebarBounds.x)}
$sidebarTop = ${Math.floor(nativeSidebarBounds.y)}
$sidebarWidth = ${Math.floor(nativeSidebarBounds.width)}
$sidebarHeight = ${Math.floor(nativeSidebarBounds.height)}
$parentPid = ${process.pid}
$cursorX = ${Math.floor(nativeCursorPoint.x)}
$cursorY = ${Math.floor(nativeCursorPoint.y)}
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
            timeout: 1200,
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
  const isPrimaryDisplay = isPrimaryDisplayBounds(sidebarBounds);
  const xOffsets = isPrimaryDisplay ? [16, 48, 96, 160, 224, 320] : [16, 48, 96, 160];
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
      for (const probe of probePoints) {
        const nativeProbe = dipPointToNativePoint({ x: probe.x, y: probe.y });
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
            timeout: 1200,
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
    const sidebarBounds = sidebarWin.getBounds();
    target =
      (await getFloatingDockTargetAtEdge(sidebarBounds, 'left', false)) ??
      (await getFloatingDockTargetAtEdge(sidebarBounds, 'right', false));
  }

  if (!target) {
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
  const isPrimaryDisplay = isPrimaryDisplayBounds(currentBounds);
  const snapDistance =
    process.platform === 'win32'
      ? Math.max(isPrimaryDisplay ? 12 : 8, Math.floor(threshold * (isPrimaryDisplay ? 3 : 2)))
      : Math.max(8, Math.floor(threshold * 1.5));
  const leftDistance = Math.abs(currentBounds.x - (target.bounds.x - currentBounds.width));
  const rightDistance = Math.abs(currentBounds.x - (target.bounds.x + target.bounds.width));
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

  const side = getDockSide(currentBounds, target.bounds);
  const dockBounds = getDockedBoundsForTarget(target.bounds, side, currentSidebarMode);
  const targetDisplay = getDisplayForBounds(target.bounds);
  const clamped = clampRectToWorkArea(
    dockBounds,
    targetDisplay.workArea
  );

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

function resolveModuleBounds(kind: ModuleWindowKind): Electron.Rectangle {
  const defaultWidth = kind === 'inbox' ? INBOX_DEFAULT_WIDTH : MODULE_DEFAULT_WIDTH;
  const defaultHeight = kind === 'inbox' ? INBOX_DEFAULT_HEIGHT : MODULE_DEFAULT_HEIGHT;
  const minWidth = kind === 'inbox' ? INBOX_MIN_WIDTH : MODULE_MIN_WIDTH;
  const minHeight = kind === 'inbox' ? INBOX_MIN_HEIGHT : MODULE_MIN_HEIGHT;

  if (kind === 'notifications') {
    const sidebarBounds = sidebarWin?.getBounds() ?? getDockedBounds(RAIL_SIZE);
    const sidebarAnchorPoint = {
      x: Math.round(sidebarBounds.x + sidebarBounds.width / 2),
      y: Math.round(sidebarBounds.y + sidebarBounds.height / 2),
    };
    const display = screen.getDisplayNearestPoint(sidebarAnchorPoint);
    const workArea = display.workArea;
    return clampRectToWorkArea(
      getCenteredBoundsInWorkArea(
        NOTIFICATION_CENTER_WIDTH,
        NOTIFICATION_CENTER_HEIGHT,
        workArea
      ),
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

  const remembered = moduleWindowBoundsMemory.get(kind);
  if (
    !shouldUseDockRelativePlacement &&
    remembered &&
    remembered.sidebarPosition === currentSidebarPosition
  ) {
    const width = Math.max(
      minWidth,
      Math.min(remembered.bounds.width, workArea.width - WINDOW_MARGIN * 2)
    );
    const height = Math.max(
      minHeight,
      Math.min(remembered.bounds.height, workArea.height - WINDOW_MARGIN * 2)
    );
    const candidate = clampRectToWorkArea(
      { x: remembered.bounds.x, y: remembered.bounds.y, width, height },
      workArea
    );
    if (isRectInsideWorkArea(candidate, workArea)) {
      return candidate;
    }
  }

  const maxWidth = Math.max(minWidth, workArea.width - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(minHeight, workArea.height - WINDOW_MARGIN * 2);
  const targetWidth = Math.min(defaultWidth, maxWidth);
  const targetHeight = Math.min(defaultHeight, maxHeight);

  const leftSpace = sidebarBounds.x - workArea.x - MODULE_GAP - WINDOW_MARGIN;
  const rightSpace =
    workArea.x +
    workArea.width -
    (sidebarBounds.x + sidebarBounds.width) -
    MODULE_GAP -
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
  const width = Math.max(
    minWidth,
    Math.min(targetWidth, Math.max(minWidth, sideSpace))
  );
  const height = targetHeight;

  const x =
    side === 'right'
      ? sidebarBounds.x + sidebarBounds.width + MODULE_GAP
      : sidebarBounds.x - width - MODULE_GAP;
  const y = sidebarBounds.y;
  const candidate = clampRectToWorkArea({ x, y, width, height }, workArea);
  const fitsWithoutOverlap =
    (side === 'right' && candidate.x >= sidebarBounds.x + sidebarBounds.width + MODULE_GAP) ||
    (side === 'left' && candidate.x + candidate.width <= sidebarBounds.x - MODULE_GAP);

  if (fitsWithoutOverlap && isRectInsideWorkArea(candidate, workArea)) {
    return candidate;
  }

  return clampRectToWorkArea(getCenteredBoundsInWorkArea(width, height, workArea), workArea);
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
  sidebarWin.setAlwaysOnTop(sidebarAlwaysOnTop, 'screen-saver');
  sidebarWin.setResizable(false);
  setWindowButtonVisibility(sidebarWin, false);
  const isOpeningSidebar = mode === 'expanded' && previousMode !== 'expanded';
  syncTouchBar();
  setSidebarBounds(bounds, animate && (!isOpeningSidebar || isHorizontalDock));
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
    void runNotificationScheduler();
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

  // Keep sidebar translucency pure RGBA/CSS-only to avoid platform compositor blur artifacts.

  lockWindowZoom(sidebarWin);
  attachNativeContextMenu(sidebarWin);

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
  focusSection?: string | null
) {
  const existing = moduleWins.get(kind);
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
  }
}

function openModuleWindow(
  kind: ModuleWindowKind,
  focusDate?: string | null,
  focusProjectId?: string | null,
  focusNoteId?: string | null,
  focusTaskId?: string | null,
  focusContext?: string | null,
  focusSection?: string | null
) {
  const existing = moduleWins.get(kind);
  if (existing && !existing.isDestroyed()) {
    holdCurrentFloatingDockTarget();
    if (
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

  // Quick capture modules use smaller dimensions
  const isQuickCapture = kind === 'quick-task' || kind === 'quick-note' || kind === 'quick-event';
  const isNotificationCenter = kind === 'notifications';
  const isInbox = kind === 'inbox';
  holdCurrentFloatingDockTarget();
  let initialBounds = resolveModuleBounds(kind);

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
    : isInbox
    ? INBOX_MIN_WIDTH
    : MODULE_MIN_WIDTH;
  const minHeight = isQuickCapture
    ? QUICK_CAPTURE_HEIGHT
    : isNotificationCenter
    ? NOTIFICATION_CENTER_MIN_HEIGHT
    : isInbox
    ? INBOX_MIN_HEIGHT
    : MODULE_MIN_HEIGHT;

  const moduleWin = new BrowserWindow({
    ...initialBounds,
    show: false,
    transparent: process.platform !== 'win32',
    backgroundColor:
      process.platform === 'win32' ? desktopTokens.colors.background : '#00000000',
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
  attachNativeContextMenu(moduleWin);

  moduleWins.set(kind, moduleWin);

  moduleWin.on('minimize', () => {
    suspendCurrentFloatingDockTarget('suspended_minimized');
    sidebarWin?.webContents.send('module:state-changed', { kind, state: 'minimized' });
  });

  moduleWin.on('close', () => {
    sidebarWin?.webContents.send('module:state-changed', { kind, state: 'closed' });
  });

  moduleWin.on('closed', () => {
    moduleWins.delete(kind);
    moduleWindowFullscreenBoundsMemory.delete(kind);
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
      const isF11 = key === 'f11';
      const isEscape = key === 'escape' || key === 'esc';
      if ((isEscape || isF11) && moduleWin && !moduleWin.isDestroyed() && moduleWin.isFullScreen()) {
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
        moduleWin.show();
        moduleWin.focus();
      }
    } catch (err) {}
  });

  moduleWin.on('leave-full-screen', () => {
    try {
      if (!moduleWin.isDestroyed()) {
        applyWindowsModuleWindowShape(moduleWin);
        moduleWin.show();
        moduleWin.focus();
      }
    } catch (err) {}
  });

  if (!isQuickCapture) {
    const rememberBounds = () => {
      if (moduleWin.isDestroyed() || moduleWindowFullscreenBoundsMemory.has(kind)) return;
      const bounds = moduleWin.getBounds();
      moduleWindowBoundsMemory.set(kind, {
        bounds,
        sidebarPosition: currentSidebarPosition,
      });
    };
    moduleWin.on('moved', rememberBounds);
    moduleWin.on('resized', rememberBounds);
  }

  const focusDateQuery = focusDate ? `&focusDate=${encodeURIComponent(focusDate)}` : '';
  const focusProjectQuery = focusProjectId
    ? `&focusProjectId=${encodeURIComponent(focusProjectId)}`
    : '';
  const focusNoteQuery = focusNoteId ? `&focusNoteId=${encodeURIComponent(focusNoteId)}` : '';
  const focusTaskQuery = focusTaskId ? `&focusTaskId=${encodeURIComponent(focusTaskId)}` : '';
  const focusContextQuery = focusContext ? `&focusContext=${encodeURIComponent(focusContext)}` : '';
  const focusSectionQuery = kind === 'settings' && focusSection
    ? `&section=${encodeURIComponent(focusSection)}`
    : '';
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
      focusSection
    );
  });
  try {
    const moduleUrl = getRendererUrl(
      `?window=module&module=${kind}${focusDateQuery}${focusProjectQuery}${focusNoteQuery}${focusTaskQuery}${focusContextQuery}${focusSectionQuery}`
    );
    moduleWin.loadURL(moduleUrl);
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
    if (preferences.floatingPosition) {
      currentFloatingPosition = {
        x: preferences.floatingPosition.x,
        y: preferences.floatingPosition.y,
      };
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

ipcMain.handle('window:toggle-module', (_event, payload: ModuleWindowKind | ModuleFocusPayload) => {
  const kind = typeof payload === 'string' ? payload : payload.kind;
  const focusDate = typeof payload === 'string' ? undefined : payload.focusDate;
  const focusProjectId = typeof payload === 'string' ? undefined : payload.focusProjectId;
  const focusNoteId = typeof payload === 'string' ? undefined : payload.focusNoteId;
  const focusTaskId = typeof payload === 'string' ? undefined : payload.focusTaskId;
  const focusContext = typeof payload === 'string' ? undefined : payload.focusContext;
  const existing = moduleWins.get(kind);

  if (existing && !existing.isDestroyed()) {
    if (focusDate || focusProjectId || focusNoteId || focusTaskId) {
      if (existing.isMinimized()) {
        existing.restore();
      }
      existing.show();
      existing.focus();
      sendModuleFocus(kind, focusDate, focusProjectId, focusNoteId, focusTaskId, focusContext);
      return;
    }

    if (existing.isMinimized()) {
      existing.restore();
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

  openModuleWindow(kind, focusDate, focusProjectId, focusNoteId, focusTaskId, focusContext);
});

ipcMain.handle('window:open-module', (_event, payload: ModuleWindowKind | ModuleFocusPayload) => {
  const kind = typeof payload === 'string' ? payload : payload.kind;
  const focusDate = typeof payload === 'string' ? undefined : payload.focusDate;
  const focusProjectId = typeof payload === 'string' ? undefined : payload.focusProjectId;
  const focusNoteId = typeof payload === 'string' ? undefined : payload.focusNoteId;
  const focusTaskId = typeof payload === 'string' ? undefined : payload.focusTaskId;
  const focusContext = typeof payload === 'string' ? undefined : payload.focusContext;
  const existing = moduleWins.get(kind);

  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.show();
    // Delay focus slightly to prevent sidebar from stealing focus back
    setTimeout(() => {
      if (!existing.isDestroyed()) {
        existing.focus();
      }
    }, 100);
    sendModuleFocus(kind, focusDate, focusProjectId, focusNoteId, focusTaskId, focusContext);
    return;
  }

  openModuleWindow(kind, focusDate, focusProjectId, focusNoteId, focusTaskId, focusContext);
});

ipcMain.handle('window:close-module', (_event, kind: ModuleWindowKind) => {
  const existing = moduleWins.get(kind);
  if (!existing || existing.isDestroyed()) return;
  existing.close();
});

ipcMain.handle('window:minimize-module', (_event, kind: ModuleWindowKind) => {
  const existing = moduleWins.get(kind);
  if (!existing || existing.isDestroyed()) return;
  suspendCurrentFloatingDockTarget('suspended_minimized');
  existing.minimize();
});

ipcMain.handle('window:toggle-module-fullscreen', (_event, kind: ModuleWindowKind) => {
  const existing = moduleWins.get(kind);
  if (!existing || existing.isDestroyed()) return false;
  if (existing.isMinimized()) {
    existing.restore();
  }
  const isPseudoFullscreen = moduleWindowFullscreenBoundsMemory.has(kind);
  const isNativeFullscreen = existing.isFullScreen();

  if (!isPseudoFullscreen && !isNativeFullscreen) {
    enterModuleWindowFullscreen(kind, existing);
    return true;
  }

  if (isNativeFullscreen) {
    existing.setFullScreen(false);
  }
  restoreModuleWindowBounds(kind, existing);
  return false;
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
    (_event, payload?: { accessToken?: string | null; userId?: string | null; apiUrl?: string | null }) => {
      syncNotificationSession(payload ?? null);
    }
  );
  ipcMain.on('notifications:refresh', () => {
    void runNotificationScheduler();
  });

  // Setup Touch Bar for macOS
  setTimeout(() => syncTouchBar(), 500);

  notificationSchedulerTimer = setInterval(() => {
    void runNotificationScheduler();
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

  if (process.platform === 'win32') {
    const closeFocusedWindowShortcut = 'Ctrl+W';
    const closeFocusedWindowRegistered = globalShortcut.register(
      closeFocusedWindowShortcut,
      () => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow || focusedWindow.isDestroyed()) return;
        focusedWindow.close();
      }
    );

    if (!closeFocusedWindowRegistered) {
      console.warn(
        `[electron] Failed to register close focused window shortcut: ${closeFocusedWindowShortcut}`
      );
    }
  }
});

app.on('before-quit', () => {
  isQuittingApp = true;
  if (notificationSchedulerTimer !== null) {
    clearInterval(notificationSchedulerTimer);
    notificationSchedulerTimer = null;
  }
});
