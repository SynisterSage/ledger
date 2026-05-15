import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  globalShortcut,
  systemPreferences,
  TouchBar,
  Menu,
} from 'electron';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { defaultSidebarPreferences } from '../src/config/sidebarPreferences';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

// File-based logging for dock debugging (disabled unless LEDGER_DOCK_DEBUG=1)
const logFile = path.join(app.getPath('userData'), 'dock-debug.log');
const dockDebugEnabled = process.env.LEDGER_DOCK_DEBUG === '1';
const dockLog = (message: string) => {
  if (!dockDebugEnabled) return;
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
  } catch {}
};

const require = createRequire(import.meta.url);

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

const toInfo = (window, sidebar = null) => {
  try {
    const bounds = window.getBounds && window.getBounds()
    if (!bounds) return null
    const x = Number(bounds.x)
    const y = Number(bounds.y)
    const width = Number(bounds.width)
    const height = Number(bounds.height)
    if (![x, y, width, height].every(Number.isFinite)) return null
    if (isSidebarRect(x, y, width, height, sidebar)) return null
    if (width < 80 || height < 80) return null
    return { id: String(window.id), x, y, width, height }
  } catch {
    return null
  }
}

const getWindowsWithInfo = (sidebar = null) => {
  const out = []
  for (const window of windowManager.getWindows()) {
    const info = toInfo(window, sidebar)
    if (info) out.push({ window, info })
  }
  return out
}

const findWindowById = (id) => {
  for (const item of getWindowsWithInfo()) {
    if (item.info.id === id) return item.window
  }
  return null
}

const scoreDockTarget = ({ sidebar, threshold }) => {
  const sidebarLeft = Math.floor(sidebar.x)
  const sidebarTop = Math.floor(sidebar.y)
  const sidebarRight = Math.floor(sidebar.x + sidebar.width)
  const sidebarBottom = Math.floor(sidebar.y + sidebar.height)
  const sidebarHeight = Math.floor(sidebar.height)
  const dockThreshold = Math.floor(threshold)
  const minimumOverlap = Math.min(96, Math.max(32, Math.floor(sidebarHeight * 0.18)))
  let bestScore = Infinity
  let best = null

  for (const item of getWindowsWithInfo(sidebar)) {
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

const findAtEdge = ({ probes, sidebar }) => {
  const windows = getWindowsWithInfo(sidebar).map((item) => item.info)
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
    target: { platform: 'darwin', id: result.window.id, side: result.side },
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
  trackingWindow = findWindowById(target.id)
  trackingTimer = setInterval(() => {
    let bounds = null
    try {
      if (!trackingWindow) {
        trackingWindow = findWindowById(target.id)
      }
      bounds = trackingWindow && trackingWindow.getBounds ? trackingWindow.getBounds() : null
    } catch {
      bounds = null
    }

    if (!bounds) {
      trackingMisses += 1
      if (trackingMisses % 4 === 0) {
        trackingWindow = findWindowById(target.id)
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
  | 'settings'
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
};

let sidebarWin: BrowserWindow | null = null;
const moduleWins = new Map<ModuleWindowKind, BrowserWindow>();
let currentSidebarMode: SidebarWindowMode = 'auth';
let currentSidebarPosition: 'left' | 'right' | 'floating' = 'right';
let currentFloatingPosition = { ...defaultSidebarPreferences.floatingPosition };
let currentSidebarPreferences = { ...defaultSidebarPreferences };
let currentFloatingDockTarget: FloatingDockTarget | null = null;
let currentFloatingDockBounds: Rect | null = null;
let currentFloatingDockMisses = 0;
let floatingDockDragActive = false;
let floatingDockTrackingTimer: NodeJS.Timeout | null = null;
let floatingDockNativeTracker: ChildProcessWithoutNullStreams | null = null;
let floatingDockNativeBuffer = '';
let sidebarIsVisible = true;
let sidebarAlwaysOnTop = true;
let macAccessibilityPrompted = false;
let lastSidebarToggleAt = 0;
let allLedgerWindowsHidden = false;
let sidebarWasVisibleBeforeHideAll = false;
const moduleKindsVisibleBeforeHideAll = new Set<ModuleWindowKind>();
const moduleWindowBoundsMemory = new Map<
  ModuleWindowKind,
  {
    bounds: Electron.Rectangle;
    sidebarPosition: 'left' | 'right' | 'floating';
  }
>();

const WINDOW_MARGIN = 16;
const RAIL_SIZE = 64;
const COLLAPSED_SIZE = 64;
const EXPANDED_WIDTH = 320;
const FLOATING_EXPANDED_HEIGHT = 760;
const FLOATING_RAIL_HEIGHT = 520;
const MIN_DOCK_HEIGHT = {
  expanded: 640,
  compact: 480,
  minimized: 480,
} as const;
const DASHBOARD_WIDTH = 1280;
const DASHBOARD_HEIGHT = 860;
const AUTH_WIDTH = 540;
const AUTH_HEIGHT = 560;
const MODULE_DEFAULT_WIDTH = 1440;
const MODULE_DEFAULT_HEIGHT = 860;
const MODULE_MIN_WIDTH = 1100;
const MODULE_MIN_HEIGHT = 720;
const QUICK_CAPTURE_WIDTH = 400;
const QUICK_CAPTURE_HEIGHT = 320;
const MODULE_GAP = 12;

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
  };
}

function getDockedBounds(
  width: number,
  position: 'left' | 'right' | 'floating' = currentSidebarPosition
) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea;
  const minHeight = Math.min(MIN_DOCK_HEIGHT.expanded, workHeight - WINDOW_MARGIN * 2);
  const maxHeight = workHeight - WINDOW_MARGIN * 2;
  const height = Math.max(minHeight, Math.min(maxHeight, maxHeight));

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
  position: 'left' | 'right' | 'floating' = currentSidebarPosition
) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea;
  const safeSize = Math.min(size, workWidth - WINDOW_MARGIN * 2, workHeight - WINDOW_MARGIN * 2);

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

  return clampRectToWorkArea(
    {
      x: currentFloatingPosition.x,
      y: currentFloatingPosition.y,
      width,
      height,
    },
    display.workArea
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

function getDisplayMatchingNativeRect(rect: Rect) {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return screen.getPrimaryDisplay();

  let bestDisplay = displays[0];
  let bestOverlap = -1;

  for (const display of displays) {
    const physicalBounds = {
      x: display.bounds.x * display.scaleFactor,
      y: display.bounds.y * display.scaleFactor,
      width: display.bounds.width * display.scaleFactor,
      height: display.bounds.height * display.scaleFactor,
    };

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

    if (overlapArea > bestOverlap) {
      bestOverlap = overlapArea;
      bestDisplay = display;
    }
  }

  return bestDisplay;
}

function nativeRectToDipRect(rect: Rect) {
  const display = getDisplayMatchingNativeRect(rect);
  return {
    x: Math.round(rect.x / display.scaleFactor),
    y: Math.round(rect.y / display.scaleFactor),
    width: Math.max(1, Math.round(rect.width / display.scaleFactor)),
    height: Math.max(1, Math.round(rect.height / display.scaleFactor)),
  };
}

function getDockSide(currentBounds: Rect, targetBounds: Rect): DockSide {
  const leftDistance = Math.abs(currentBounds.x - (targetBounds.x - currentBounds.width));
  const rightDistance = Math.abs(currentBounds.x - (targetBounds.x + targetBounds.width));
  return leftDistance <= rightDistance ? 'left' : 'right';
}

function getDockedBoundsForTarget(targetBounds: Rect, side: DockSide, mode: SidebarWindowMode) {
  const { width: workWidth, height: workHeight } = screen.getDisplayMatching(targetBounds).workArea;
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
    screen.getDisplayMatching(targetBounds).workArea
  );
}

function sendFloatingDockChanged(isDocked: boolean) {
  try {
    if (sidebarWin && !sidebarWin.isDestroyed() && !sidebarWin.webContents.isDestroyed()) {
      sidebarWin.webContents.send('sidebar:floating-dock-changed', { isDocked });
    }
  } catch {
    // The window can be torn down between the destroyed check and the send.
  }
}

function setCurrentFloatingDockTarget(target: FloatingDockTarget | null, bounds: Rect | null) {
  currentFloatingDockTarget = target;
  currentFloatingDockBounds = bounds;
  currentFloatingDockMisses = 0;
  sendFloatingDockChanged(Boolean(target && bounds));
}

function clearCurrentFloatingDockTarget() {
  stopFloatingDockNativeTracker();
  stopMacDockHelperTracking();
  currentFloatingDockTarget = null;
  currentFloatingDockBounds = null;
  currentFloatingDockMisses = 0;
  sendFloatingDockChanged(false);
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
      currentFloatingDockTarget = null;
      currentFloatingDockBounds = null;
      currentFloatingDockMisses = 0;
      sendFloatingDockChanged(false);
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

function applyFloatingDockTargetBounds(targetBounds: Rect, side: DockSide) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  if (currentSidebarPosition !== 'floating') return;
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return;
  if (floatingDockDragActive) return;

  currentFloatingDockBounds = targetBounds;
  currentFloatingDockMisses = 0;
  const nextBounds = getDockedBoundsForTarget(targetBounds, side, currentSidebarMode);
  if (rectsMatch(sidebarWin.getBounds(), nextBounds)) return;
  if (!setSidebarBounds(nextBounds)) return;
  currentFloatingPosition = { x: nextBounds.x, y: nextBounds.y };
}

function rectsMatch(a: Rect, b: Rect) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function setSidebarBounds(bounds: Rect, animate = false) {
  try {
    if (!sidebarWin || sidebarWin.isDestroyed()) return false;
    sidebarWin.setBounds(bounds, animate);
    return true;
  } catch {
    return false;
  }
}

function handleNativeDockTrackerLine(line: string, side: DockSide) {
  const [kind, x, y, width, height] = line.trim().split('|');
  if (kind !== 'bounds') return;
  const parsed = [x, y, width, height].map((value) => Number(value));
  if (parsed.some((value) => Number.isNaN(value) || value <= 0)) return;
  const dipRect = nativeRectToDipRect({
    x: parsed[0],
    y: parsed[1],
    width: parsed[2],
    height: parsed[3],
  });
  applyFloatingDockTargetBounds(
    { x: dipRect.x, y: dipRect.y, width: dipRect.width, height: dipRect.height },
    side
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
  private const uint WINEVENT_OUTOFCONTEXT = 0;
  private static IntPtr targetHwnd;
  private static WinEventDelegate callbackRef = Callback;

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

  [DllImport("user32.dll")]
  private static extern bool IsWindow(IntPtr hWnd);

  public static void Start(long hwndValue) {
    targetHwnd = new IntPtr(hwndValue);
    EmitBounds();
    IntPtr hook = SetWinEventHook(
      EVENT_OBJECT_LOCATIONCHANGE,
      EVENT_OBJECT_LOCATIONCHANGE,
      IntPtr.Zero,
      callbackRef,
      0,
      0,
      WINEVENT_OUTOFCONTEXT
    );
    MSG msg;
    while (IsWindow(targetHwnd) && GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {}
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
    EmitBounds();
  }

  private static void EmitBounds() {
    RECT rect;
    if (!GetWindowRect(targetHwnd, out rect)) return;
    Console.Out.WriteLine("bounds|" + rect.Left + "|" + rect.Top + "|" + (rect.Right - rect.Left) + "|" + (rect.Bottom - rect.Top));
    Console.Out.Flush();
  }
}
"@
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
}): Promise<DockTargetResult | null> {
  const sidebarBounds = sidebarWin?.getBounds();
  return requestMacDockHelper({
    kind: 'dockAtEdge',
    probes: [probe],
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

  const sidebarBounds = sidebarWin.getBounds();
  const dockTarget = currentFloatingDockTarget;
  const target = await getFloatingDockTargetAtEdge(sidebarBounds, dockTarget.side);

  if (!sidebarWin || sidebarWin.isDestroyed()) return;

  if (!target) {
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
      return;
    }
    clearCurrentFloatingDockTarget();
    stopFloatingDockTracking();
    // Reflow to normal floating geometry once dock target is gone.
    applySidebarWindowMode(currentSidebarMode);
    return;
  }

  currentFloatingDockMisses = 0;
  currentFloatingDockTarget = target.target;
  currentFloatingDockBounds = target.bounds;
  const nextBounds = getDockedBoundsForTarget(
    target.bounds,
    currentFloatingDockTarget.side,
    currentSidebarMode
  );
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  if (rectsMatch(sidebarWin.getBounds(), nextBounds)) return;
  if (!setSidebarBounds(nextBounds)) return;
  currentFloatingPosition = { x: nextBounds.x, y: nextBounds.y };
}

async function getFloatingDockTargetAtCursor(): Promise<DockTargetResult | null> {
  try {
    const sidebarBounds = sidebarWin?.getBounds();
    if (!sidebarBounds) return null;
    const threshold = currentSidebarPreferences.floatingDockThreshold;

    if (process.platform === 'win32') {
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
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
"@
$sidebarLeft = ${Math.floor(sidebarBounds.x)}
$sidebarTop = ${Math.floor(sidebarBounds.y)}
$sidebarRight = ${Math.floor(sidebarBounds.x + sidebarBounds.width)}
$sidebarBottom = ${Math.floor(sidebarBounds.y + sidebarBounds.height)}
$sidebarHeight = ${Math.floor(sidebarBounds.height)}
$threshold = ${Math.floor(threshold)}
$script:result = $null
$script:bestScore = [Double]::PositiveInfinity
[Win32]::EnumWindows({
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  $rect = [Win32+RECT]::new()
  if (-not [Win32]::GetWindowRect($hWnd, [ref]$rect)) { return $true }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ([Math]::Abs($rect.Left - $sidebarLeft) -le 2 -and [Math]::Abs($rect.Top - $sidebarTop) -le 2 -and [Math]::Abs($width - ${Math.floor(
    sidebarBounds.width
  )}) -le 2 -and [Math]::Abs($height - $sidebarHeight) -le 2) { return $true }
  if ($width -lt 80 -or $height -lt 80) { return $true }

  $overlapTop = [Math]::Max($sidebarTop, $rect.Top)
  $overlapBottom = [Math]::Min($sidebarBottom, $rect.Bottom)
  $verticalOverlap = [Math]::Max(0, $overlapBottom - $overlapTop)
  $verticalGap = 0
  if ($sidebarBottom -lt $rect.Top) { $verticalGap = $rect.Top - $sidebarBottom }
  elseif ($sidebarTop -gt $rect.Bottom) { $verticalGap = $sidebarTop - $rect.Bottom }

  $minimumOverlap = [Math]::Min(96, [Math]::Max(32, [Math]::Floor($sidebarHeight * 0.18)))
  if ($verticalOverlap -lt $minimumOverlap -and $verticalGap -gt ($threshold * 2)) { return $true }

  $dockLeftDistance = [Math]::Abs($sidebarRight - $rect.Left)
  $dockRightDistance = [Math]::Abs($sidebarLeft - $rect.Right)
  $side = "left"
  $edgeDistance = $dockLeftDistance
  if ($dockRightDistance -lt $dockLeftDistance) {
    $side = "right"
    $edgeDistance = $dockRightDistance
  }
  if ($edgeDistance -gt ($threshold * 2)) { return $true }

  $verticalPenalty = if ($verticalOverlap -gt 0) { 0 } else { $verticalGap }
  $score = $edgeDistance + ($verticalPenalty * 0.5) - ($verticalOverlap * 0.01)
  if ($score -lt $script:bestScore) {
    $script:bestScore = $score
    $script:result = "$side|$($hWnd.ToInt64())|$($rect.Left)|$($rect.Top)|$width|$height"
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
      const [side, id, x, y, width, height] = String(stdout).trim().split('|');
      const parsed = [x, y, width, height].map((value) => Number(value));
      if (
        parsed.some((value) => Number.isNaN(value) || value <= 0) ||
        !id ||
        (side !== 'left' && side !== 'right')
      ) {
        return null;
      }
      const bounds = nativeRectToDipRect({
        x: parsed[0],
        y: parsed[1],
        width: parsed[2],
        height: parsed[3],
      });
      return {
        target: {
          platform: 'win32',
          id,
          side,
        },
        bounds,
      };
    }

    if (process.platform === 'darwin') {
      return getMacAccessibilityDockTargetAtCursor(sidebarBounds, threshold);
    }
  } catch (error) {
    console.warn('[electron] Could not determine foreground app bounds:', error);
  }

  return null;
}

async function getFloatingDockTargetAtEdge(
  sidebarBounds: Electron.Rectangle,
  side: DockSide
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
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
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
}
"@
$sidebarLeft = ${Math.floor(sidebarBounds.x)}
$sidebarTop = ${Math.floor(sidebarBounds.y)}
$sidebarWidth = ${Math.floor(sidebarBounds.width)}
$sidebarHeight = ${Math.floor(sidebarBounds.height)}
$cursor = [Win32+POINT]::new()
$cursor.X = ${Math.floor(probeX)}
$cursor.Y = ${Math.floor(probeY)}
$script:result = $null
[Win32]::EnumWindows({
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  $rect = [Win32+RECT]::new()
  if (-not [Win32]::GetWindowRect($hWnd, [ref]$rect)) { return $true }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ([Math]::Abs($rect.Left - $sidebarLeft) -le 2 -and [Math]::Abs($rect.Top - $sidebarTop) -le 2 -and [Math]::Abs($width - $sidebarWidth) -le 2 -and [Math]::Abs($height - $sidebarHeight) -le 2) { return $true }
  if ($cursor.X -ge $rect.Left -and $cursor.X -le $rect.Right -and $cursor.Y -ge $rect.Top -and $cursor.Y -le $rect.Bottom) {
    $script:result = "$($hWnd.ToInt64())|$($rect.Left)|$($rect.Top)|$width|$height"
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($script:result) { Write-Output $script:result }
`;
    for (const probe of probePoints) {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          script(probe.x, probe.y),
        ],
        {
          windowsHide: true,
          timeout: 1200,
        }
      );
      const [id, x, y, width, height] = String(stdout).trim().split('|');
      const parsed = [x, y, width, height].map((value) => Number(value));
      if (parsed.some((value) => Number.isNaN(value) || value <= 0) || !id) continue;
      return {
        target: {
          platform: 'win32',
          id,
          side: probe.side,
        },
        bounds: { x: parsed[0], y: parsed[1], width: parsed[2], height: parsed[3] },
      };
    }
    return null;
  }

  if (process.platform === 'darwin') {
    for (const probe of probePoints) {
      const target = await getMacAccessibilityDockTargetAtEdge(probe);
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
      : await getFloatingDockTargetAtCursor();

  if (!target) {
    clearCurrentFloatingDockTarget();
    stopFloatingDockTracking();
    return null;
  }

  const currentBounds = sidebarWin.getBounds();
  const threshold = currentSidebarPreferences.floatingDockThreshold;
  const leftDistance = Math.abs(currentBounds.x - (target.bounds.x - currentBounds.width));
  const rightDistance = Math.abs(currentBounds.x - (target.bounds.x + target.bounds.width));
  const nearestDistance = Math.min(leftDistance, rightDistance);
  if (nearestDistance > threshold * 2) {
    clearCurrentFloatingDockTarget();
    stopFloatingDockTracking();
    return null;
  }

  const side = getDockSide(currentBounds, target.bounds);
  const dockBounds = getDockedBoundsForTarget(target.bounds, side, currentSidebarMode);
  const clamped = clampRectToWorkArea(
    dockBounds,
    screen.getDisplayMatching(target.bounds).workArea
  );

  setCurrentFloatingDockTarget({ ...target.target, side }, target.bounds);
  if (!setSidebarBounds(clamped)) return null;
  currentFloatingPosition = { x: clamped.x, y: clamped.y };
  if (!startFloatingDockNativeTracker({ ...target.target, side })) {
    startFloatingDockTracking();
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
  const sidebarBounds = sidebarWin?.getBounds() ?? getDockedBounds(RAIL_SIZE);
  const sidebarAnchorPoint = {
    x: Math.round(sidebarBounds.x + sidebarBounds.width / 2),
    y: Math.round(sidebarBounds.y + sidebarBounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(sidebarAnchorPoint);
  const workArea = display.workArea;

  const remembered = moduleWindowBoundsMemory.get(kind);
  if (remembered && remembered.sidebarPosition === currentSidebarPosition) {
    const width = Math.max(
      MODULE_MIN_WIDTH,
      Math.min(remembered.bounds.width, workArea.width - WINDOW_MARGIN * 2)
    );
    const height = Math.max(
      MODULE_MIN_HEIGHT,
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

  const maxWidth = Math.max(MODULE_MIN_WIDTH, workArea.width - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(MODULE_MIN_HEIGHT, workArea.height - WINDOW_MARGIN * 2);
  const targetWidth = Math.min(MODULE_DEFAULT_WIDTH, maxWidth);
  const targetHeight = Math.min(MODULE_DEFAULT_HEIGHT, maxHeight);

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
    MODULE_MIN_WIDTH,
    Math.min(targetWidth, Math.max(MODULE_MIN_WIDTH, sideSpace))
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

function applySidebarWindowMode(mode: SidebarWindowMode) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  currentSidebarMode = mode;

  if (mode === 'fullscreen') {
    floatingDockDragActive = false;
    clearCurrentFloatingDockTarget();
    stopFloatingDockTracking();
    const bounds = getCenteredBounds(DASHBOARD_WIDTH, DASHBOARD_HEIGHT);
    sidebarWin.setAlwaysOnTop(false);
    sidebarWin.setResizable(true);
    setWindowButtonVisibility(sidebarWin, true);
    setSidebarBounds(bounds);
    return;
  }

  if (mode === 'auth') {
    floatingDockDragActive = false;
    clearCurrentFloatingDockTarget();
    stopFloatingDockTracking();
    const bounds = getCenteredBoundsForCurrentSidebarDisplay(AUTH_WIDTH, AUTH_HEIGHT);
    sidebarWin.setAlwaysOnTop(false);
    sidebarWin.setResizable(false);
    setWindowButtonVisibility(sidebarWin, false);
    setSidebarBounds(bounds);
    return;
  }

  const bounds =
    currentSidebarPosition === 'floating'
      ? getFloatingBounds(mode)
      : mode === 'compact'
      ? getCollapsedBounds(COLLAPSED_SIZE)
      : mode === 'minimized'
      ? getDockedBounds(RAIL_SIZE)
      : getDockedBounds(EXPANDED_WIDTH);
  sidebarWin.setAlwaysOnTop(sidebarAlwaysOnTop, 'screen-saver');
  sidebarWin.setResizable(false);
  setWindowButtonVisibility(sidebarWin, false);
  setSidebarBounds(bounds);
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
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return;
}

function applySidebarVisibility(isVisible: boolean) {
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

  sidebarWin.show();
  applySidebarWindowMode(currentSidebarMode);
  sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: true });
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
        console.log('[electron][sidebar] did-finish-load');
        if (sidebarWin && !sidebarWin.isDestroyed()) {
          sidebarWin.webContents.send('app:did-finish-load');
          if (sidebarWin.isMinimized()) {
            sidebarWin.restore();
          }
          // Reset to docked state to ensure valid bounds
          const dockedBounds = getDockedBounds(EXPANDED_WIDTH);
          sidebarWin.setBounds(dockedBounds);
          sidebarWin.show();
          sidebarWin.focus();
          console.log('[electron][sidebar] window bounds reset:', dockedBounds);
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
  focusContext?: string | null
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
  }
}

function openModuleWindow(
  kind: ModuleWindowKind,
  focusDate?: string | null,
  focusProjectId?: string | null,
  focusNoteId?: string | null,
  focusTaskId?: string | null,
  focusContext?: string | null
) {
  const existing = moduleWins.get(kind);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    sendModuleFocus(kind, focusDate, focusProjectId, focusNoteId, focusTaskId, focusContext);
    return;
  }

  // Quick capture modules use smaller dimensions
  const isQuickCapture = kind === 'quick-task' || kind === 'quick-note' || kind === 'quick-event';
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

  const minWidth = isQuickCapture ? QUICK_CAPTURE_WIDTH : MODULE_MIN_WIDTH;
  const minHeight = isQuickCapture ? QUICK_CAPTURE_HEIGHT : MODULE_MIN_HEIGHT;

  const moduleWin = new BrowserWindow({
    ...initialBounds,
    transparent: true,
    backgroundColor: '#00000000',
    ...getModuleWindowChromeOptions(),
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

  if (process.platform === 'win32') {
    moduleWin.setBackgroundMaterial('auto');
  }

  lockWindowZoom(moduleWin);
  attachNativeContextMenu(moduleWin);

  moduleWins.set(kind, moduleWin);

  moduleWin.on('minimize', () => {
    sidebarWin?.webContents.send('module:state-changed', { kind, state: 'minimized' });
  });

  moduleWin.on('close', () => {
    sidebarWin?.webContents.send('module:state-changed', { kind, state: 'closed' });
  });

  moduleWin.on('closed', () => {
    moduleWins.delete(kind);
  });

  if (!isQuickCapture) {
    const rememberBounds = () => {
      if (moduleWin.isDestroyed()) return;
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
  moduleWin.webContents.once('did-finish-load', () => {
    moduleWin.show();
    moduleWin.focus();
    sendModuleFocus(kind, focusDate, focusProjectId, focusNoteId, focusTaskId, focusContext);
  });
  try {
    const moduleUrl = getRendererUrl(
      `?window=module&module=${kind}${focusDateQuery}${focusProjectQuery}${focusNoteQuery}${focusTaskQuery}${focusContextQuery}`
    );
    moduleWin.loadURL(moduleUrl);
  } catch (err) {
    console.error('[electron] Error while loading module renderer:', err);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
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
  applySidebarVisibility(isVisible);
});

ipcMain.handle('window:hide-temporary', () => {
  if (!sidebarWin || sidebarWin.isDestroyed()) return;
  sidebarWin.hide();
});

ipcMain.handle('window:quit-app', () => {
  app.quit();
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
      preferences.position === 'floating';
    const hasFloatingPositionChange = Boolean(preferences.floatingPosition);
    const hasDockToggleChange = typeof preferences.floatingDockEnabled === 'boolean';
    const hasDockThresholdChange = typeof preferences.floatingDockThreshold === 'number';
    const hasViewStateChange = typeof preferences.isExpanded === 'boolean';
    const hasHiddenStateChange = typeof preferences.isHidden === 'boolean';
    const hasModeRelevantChange =
      hasPositionChange ||
      hasFloatingPositionChange ||
      hasDockToggleChange ||
      hasDockThresholdChange ||
      hasViewStateChange ||
      hasHiddenStateChange;

    if (preferences.position === 'left' || preferences.position === 'right') {
      currentSidebarPosition = preferences.position;
      clearCurrentFloatingDockTarget();
      stopFloatingDockTracking();
    } else if (preferences.position === 'floating') {
      currentSidebarPosition = 'floating';
      if (previousSidebarPosition !== 'floating') {
        clearCurrentFloatingDockTarget();
        stopFloatingDockTracking();
      }
    } else {
      clearCurrentFloatingDockTarget();
      stopFloatingDockTracking();
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
      applySidebarWindowMode(currentSidebarMode);
    }
    currentSidebarPreferences = {
      ...currentSidebarPreferences,
      ...preferences,
    };
    sidebarWin.webContents.send('sidebar:preferences-updated', preferences);
    if (
      hasModeRelevantChange &&
      currentSidebarMode !== 'auth' &&
      currentSidebarMode !== 'fullscreen'
    ) {
      applySidebarWindowMode(currentSidebarMode);
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

  // Return the actual current bounds so React can calculate delta correctly
  if (!sidebarWin || sidebarWin.isDestroyed()) return { x: 0, y: 0 };
  const bounds = sidebarWin.getBounds();
  return { x: bounds.x, y: bounds.y };
});

ipcMain.handle('window:dock-floating-window', async () => {
  return dockFloatingSidebarToTarget();
});

ipcMain.handle('window:detach-floating-window', () => {
  floatingDockDragActive = false;
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

ipcMain.handle('window:close-module', (_event, kind: ModuleWindowKind) => {
  const existing = moduleWins.get(kind);
  if (!existing || existing.isDestroyed()) return;
  existing.close();
});

ipcMain.handle('window:minimize-module', (_event, kind: ModuleWindowKind) => {
  const existing = moduleWins.get(kind);
  if (!existing || existing.isDestroyed()) return;
  existing.minimize();
});

ipcMain.handle('window:toggle-module-fullscreen', (_event, kind: ModuleWindowKind) => {
  const existing = moduleWins.get(kind);
  if (!existing || existing.isDestroyed()) return false;
  if (existing.isMinimized()) {
    existing.restore();
  }
  const next = !existing.isFullScreen();
  existing.setFullScreen(next);
  if (!next) {
    existing.show();
    existing.focus();
  }
  return next;
});

ipcMain.handle('window:open-external', async (_event, url: string) => {
  if (!/^https?:\/\//i.test(url) && !/^webcal:\/\//i.test(url)) {
    throw new Error('Unsupported external URL protocol');
  }
  await shell.openExternal(url);
});

ipcMain.handle('window:open-checkin', () => {
  applySidebarVisibility(true);
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
function setupTouchBar() {
  if (process.platform !== 'darwin' || !sidebarWin || sidebarWin.isDestroyed()) return;

  const { TouchBarButton, TouchBarSpacer } = TouchBar;

  const touchBar = new TouchBar({
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

  sidebarWin.setTouchBar(touchBar);
}

app.whenReady().then(() => {
  createSidebarWindow();

  // Setup Touch Bar for macOS
  setTimeout(() => setupTouchBar(), 500);

  const toggleSidebarShortcut = process.platform === 'darwin' ? 'Cmd+Shift+B' : 'Ctrl+Shift+B';
  const registered = globalShortcut.register(toggleSidebarShortcut, () => {
    const now = Date.now();
    if (now - lastSidebarToggleAt < 250) return;
    lastSidebarToggleAt = now;
    const nextVisible =
      sidebarWin && !sidebarWin.isDestroyed() ? !sidebarWin.isVisible() : !sidebarIsVisible;
    applySidebarVisibility(nextVisible);
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
