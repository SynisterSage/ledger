import { app, BrowserWindow, ipcMain, screen, shell, globalShortcut } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defaultSidebarPreferences } from '../src/config/sidebarPreferences'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

type SidebarWindowMode = 'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen'
type SidebarPreferencesPayload = {
  position?: 'right' | 'left' | 'top' | 'bottom' | 'floating'
  opacity?: number
  blur?: boolean
  defaultState?: 'expanded' | 'collapsed' | 'remember'
  autoHide?: boolean
  isExpanded?: boolean
  collapsedRestoreIsExpanded?: boolean
  isHidden?: boolean
  floatingPosition?: { x: number; y: number }
  floatingDockEnabled?: boolean
  floatingDockThreshold?: number
  lastState?: 'expanded' | 'collapsed'
}
type ModuleWindowKind = 'calendar' | 'notes' | 'projects' | 'dashboard' | 'settings'
type ModuleFocusPayload = {
  kind: ModuleWindowKind
  focusDate?: string | null
  focusProjectId?: string | null
  focusNoteId?: string | null
  focusTaskId?: string | null
}
type Rect = { x: number; y: number; width: number; height: number }
type DockSide = 'left' | 'right'
type FloatingDockTarget = {
  platform: 'win32' | 'darwin'
  id: string
  side: DockSide
}

let sidebarWin: BrowserWindow | null = null
const moduleWins = new Map<ModuleWindowKind, BrowserWindow>()
let currentSidebarMode: SidebarWindowMode = 'auth'
let currentSidebarPosition: 'left' | 'right' | 'floating' = 'right'
let currentFloatingPosition = { ...defaultSidebarPreferences.floatingPosition }
let currentSidebarPreferences = { ...defaultSidebarPreferences }
let currentFloatingDockTarget: FloatingDockTarget | null = null
let currentFloatingDockBounds: Rect | null = null
let currentFloatingDockMisses = 0
let floatingDockDragActive = false
let floatingDockTrackingTimer: NodeJS.Timeout | null = null
let floatingDockNativeTracker: ChildProcessWithoutNullStreams | null = null
let floatingDockNativeBuffer = ''
let sidebarIsVisible = true
let sidebarAlwaysOnTop = true

const WINDOW_MARGIN = 16
const RAIL_SIZE = 64
const COLLAPSED_SIZE = 64
const EXPANDED_WIDTH = 320
const FLOATING_EXPANDED_HEIGHT = 760
const FLOATING_RAIL_HEIGHT = 520
const MIN_DOCK_HEIGHT = {
  expanded: 640,
  compact: 480,
  minimized: 480,
} as const
const DASHBOARD_WIDTH = 1280
const DASHBOARD_HEIGHT = 860
const AUTH_WIDTH = 540
const AUTH_HEIGHT = 560
const MODULE_WIDTH = 980
const MODULE_HEIGHT = 760
const MODULE_GAP = 12

function lockWindowZoom(win: BrowserWindow) {
  const { webContents } = win

  webContents.on('did-finish-load', () => {
    webContents.setZoomFactor(1)
    void webContents.setVisualZoomLevelLimits(1, 1)
  })

  webContents.on('before-input-event', (event, input) => {
    const key = input.key?.toLowerCase() ?? ''
    const hasZoomModifier = input.control || input.meta
    const isZoomShortcut =
      hasZoomModifier && (key === '+' || key === '=' || key === '-' || key === '_' || key === '0')

    const isZoomWheelGesture = input.type === 'mouseWheel' && hasZoomModifier

    if (isZoomShortcut || isZoomWheelGesture) {
      event.preventDefault()
      webContents.setZoomFactor(1)
    }
  })
}

function setWindowButtonVisibility(win: BrowserWindow, visible: boolean) {
  const setter = (win as BrowserWindow & {
    setWindowButtonVisibility?: (visible: boolean) => void
  }).setWindowButtonVisibility

  if (typeof setter === 'function') {
    setter.call(win, visible)
  }
}

function getWindowChromeOptions() {
  if (process.platform === 'win32') {
    return {
      frame: false,
      autoHideMenuBar: true,
    }
  }

  return {
    titleBarStyle: 'hiddenInset' as const,
    autoHideMenuBar: true,
  }
}

function getModuleWindowChromeOptions() {
  return {
    frame: false,
    autoHideMenuBar: true,
  }
}

function getDockedBounds(width: number, position: 'left' | 'right' | 'floating' = currentSidebarPosition) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea
  const minHeight = Math.min(MIN_DOCK_HEIGHT.expanded, workHeight - WINDOW_MARGIN * 2)
  const maxHeight = workHeight - WINDOW_MARGIN * 2
  const height = Math.max(minHeight, Math.min(maxHeight, maxHeight))

  if (position === 'left') {
    return {
      x: x + WINDOW_MARGIN,
      y: y + WINDOW_MARGIN,
      width,
      height,
    }
  }

  return {
    x: x + workWidth - width - WINDOW_MARGIN,
    y: y + WINDOW_MARGIN,
    width,
    height,
  }
}

function getCollapsedBounds(size: number, position: 'left' | 'right' | 'floating' = currentSidebarPosition) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea
  const safeSize = Math.min(size, workWidth - WINDOW_MARGIN * 2, workHeight - WINDOW_MARGIN * 2)

  if (position === 'left') {
    return {
      x: x + WINDOW_MARGIN,
      y: y + WINDOW_MARGIN,
      width: safeSize,
      height: safeSize,
    }
  }

  return {
    x: x + workWidth - safeSize - WINDOW_MARGIN,
    y: y + WINDOW_MARGIN,
    width: safeSize,
    height: safeSize,
  }
}

function getFloatingBounds(mode: SidebarWindowMode) {
  if (currentFloatingDockTarget && currentFloatingDockBounds) {
    return getDockedBoundsForTarget(currentFloatingDockBounds, currentFloatingDockTarget.side, mode)
  }

  const display = screen.getDisplayNearestPoint(currentFloatingPosition)
  const { width: workWidth, height: workHeight } = display.workArea
  const maxWidth = workWidth - WINDOW_MARGIN * 2
  const maxHeight = workHeight - WINDOW_MARGIN * 2

  const width =
    mode === 'compact'
      ? Math.min(COLLAPSED_SIZE, maxWidth)
      : mode === 'minimized'
        ? Math.min(RAIL_SIZE, maxWidth)
        : Math.min(EXPANDED_WIDTH, maxWidth)

  const height =
    mode === 'compact'
      ? Math.min(FLOATING_RAIL_HEIGHT, maxHeight)
      : mode === 'minimized'
        ? Math.min(FLOATING_RAIL_HEIGHT, maxHeight)
        : Math.min(FLOATING_EXPANDED_HEIGHT, maxHeight)

  return clampRectToWorkArea(
    {
      x: currentFloatingPosition.x,
      y: currentFloatingPosition.y,
      width,
      height,
    },
    display.workArea,
  )
}

function getCenteredBounds(width: number, height: number) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea
  const safeWidth = Math.min(width, workWidth - WINDOW_MARGIN * 2)
  const safeHeight = Math.min(height, workHeight - WINDOW_MARGIN * 2)
  return {
    x: x + Math.floor((workWidth - safeWidth) / 2),
    y: y + Math.floor((workHeight - safeHeight) / 2),
    width: safeWidth,
    height: safeHeight,
  }
}

function clampRectToWorkArea(rect: Rect, workArea: Electron.Rectangle) {
  const maxX = workArea.x + workArea.width - rect.width
  const maxY = workArea.y + workArea.height - rect.height
  return {
    x: Math.max(workArea.x, Math.min(rect.x, maxX)),
    y: Math.max(workArea.y, Math.min(rect.y, maxY)),
    width: rect.width,
    height: rect.height,
  }
}

function getDisplayMatchingNativeRect(rect: Rect) {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) return screen.getPrimaryDisplay()

  let bestDisplay = displays[0]
  let bestOverlap = -1

  for (const display of displays) {
    const physicalBounds = {
      x: display.bounds.x * display.scaleFactor,
      y: display.bounds.y * display.scaleFactor,
      width: display.bounds.width * display.scaleFactor,
      height: display.bounds.height * display.scaleFactor,
    }

    const overlapWidth = Math.max(
      0,
      Math.min(rect.x + rect.width, physicalBounds.x + physicalBounds.width) -
        Math.max(rect.x, physicalBounds.x),
    )
    const overlapHeight = Math.max(
      0,
      Math.min(rect.y + rect.height, physicalBounds.y + physicalBounds.height) -
        Math.max(rect.y, physicalBounds.y),
    )
    const overlapArea = overlapWidth * overlapHeight

    if (overlapArea > bestOverlap) {
      bestOverlap = overlapArea
      bestDisplay = display
    }
  }

  return bestDisplay
}

function nativeRectToDipRect(rect: Rect) {
  const display = getDisplayMatchingNativeRect(rect)
  return {
    x: Math.round(rect.x / display.scaleFactor),
    y: Math.round(rect.y / display.scaleFactor),
    width: Math.max(1, Math.round(rect.width / display.scaleFactor)),
    height: Math.max(1, Math.round(rect.height / display.scaleFactor)),
  }
}

function getDockSide(currentBounds: Rect, targetBounds: Rect): DockSide {
  const leftDistance = Math.abs(currentBounds.x - (targetBounds.x - currentBounds.width))
  const rightDistance = Math.abs(currentBounds.x - (targetBounds.x + targetBounds.width))
  return leftDistance <= rightDistance ? 'left' : 'right'
}

function getDockedBoundsForTarget(targetBounds: Rect, side: DockSide, mode: SidebarWindowMode) {
  const { width: workWidth, height: workHeight } = screen.getDisplayMatching(targetBounds).workArea
  const width =
    mode === 'compact'
      ? Math.min(COLLAPSED_SIZE, workWidth - WINDOW_MARGIN * 2)
      : mode === 'minimized'
        ? Math.min(RAIL_SIZE, workWidth - WINDOW_MARGIN * 2)
        : Math.min(EXPANDED_WIDTH, workWidth - WINDOW_MARGIN * 2)
  const maxHeight = Math.max(1, workHeight - WINDOW_MARGIN * 2)
  const baseMinHeight =
    mode === 'compact'
      ? MIN_DOCK_HEIGHT.compact
      : mode === 'minimized'
        ? MIN_DOCK_HEIGHT.minimized
        : MIN_DOCK_HEIGHT.expanded
  const minHeight = Math.min(baseMinHeight, maxHeight)
  const height = Math.max(minHeight, Math.min(targetBounds.height, maxHeight))
  const x = side === 'left' ? targetBounds.x - width : targetBounds.x + targetBounds.width
  const y = targetBounds.y
  return clampRectToWorkArea({ x, y, width, height }, screen.getDisplayMatching(targetBounds).workArea)
}

function setCurrentFloatingDockTarget(target: FloatingDockTarget | null, bounds: Rect | null) {
  currentFloatingDockTarget = target
  currentFloatingDockBounds = bounds
  currentFloatingDockMisses = 0
  sidebarWin?.webContents.send('sidebar:floating-dock-changed', { isDocked: Boolean(target && bounds) })
}

function clearCurrentFloatingDockTarget() {
  stopFloatingDockNativeTracker()
  currentFloatingDockTarget = null
  currentFloatingDockBounds = null
  currentFloatingDockMisses = 0
  sidebarWin?.webContents.send('sidebar:floating-dock-changed', { isDocked: false })
}

function stopFloatingDockTracking() {
  if (floatingDockTrackingTimer !== null) {
    clearInterval(floatingDockTrackingTimer)
    floatingDockTrackingTimer = null
  }
}

function stopFloatingDockNativeTracker() {
  if (floatingDockNativeTracker !== null) {
    floatingDockNativeTracker.kill()
    floatingDockNativeTracker = null
  }
  floatingDockNativeBuffer = ''
}

function applyFloatingDockTargetBounds(targetBounds: Rect, side: DockSide) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return
  if (currentSidebarPosition !== 'floating') return
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return
  if (floatingDockDragActive) return

  currentFloatingDockBounds = targetBounds
  currentFloatingDockMisses = 0
  const nextBounds = getDockedBoundsForTarget(targetBounds, side, currentSidebarMode)
  sidebarWin.setBounds(nextBounds, false)
  currentFloatingPosition = { x: nextBounds.x, y: nextBounds.y }
}

function handleNativeDockTrackerLine(line: string, side: DockSide) {
  const [kind, x, y, width, height] = line.trim().split('|')
  if (kind !== 'bounds') return
  const parsed = [x, y, width, height].map((value) => Number(value))
  if (parsed.some((value) => Number.isNaN(value) || value <= 0)) return
  const dipRect = nativeRectToDipRect({
    x: parsed[0],
    y: parsed[1],
    width: parsed[2],
    height: parsed[3],
  })
  applyFloatingDockTargetBounds(
    { x: dipRect.x, y: dipRect.y, width: dipRect.width, height: dipRect.height },
    side,
  )
}

function startFloatingDockNativeTracker(target: FloatingDockTarget) {
  stopFloatingDockNativeTracker()

  if (target.platform !== 'win32') return false
  if (!/^\d+$/.test(target.id)) return false

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
`

  const tracker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
  })
  floatingDockNativeTracker = tracker

  tracker.stdout.on('data', (chunk) => {
    floatingDockNativeBuffer += chunk.toString()
    const lines = floatingDockNativeBuffer.split(/\r?\n/)
    floatingDockNativeBuffer = lines.pop() ?? ''
    for (const line of lines) {
      handleNativeDockTrackerLine(line, target.side)
    }
  })

  tracker.stderr.on('data', (chunk) => {
    console.warn('[electron] Floating dock tracker:', chunk.toString().trim())
  })

  tracker.on('exit', () => {
    if (floatingDockNativeTracker === tracker) {
      floatingDockNativeTracker = null
      floatingDockNativeBuffer = ''
    }
  })

  return true
}

function startFloatingDockTracking() {
  if (floatingDockTrackingTimer !== null) return
  floatingDockTrackingTimer = setInterval(() => {
    void refreshFloatingDockTarget()
  }, 48)
}

async function refreshFloatingDockTarget() {
  if (!sidebarWin || sidebarWin.isDestroyed()) return
  if (currentSidebarPosition !== 'floating') return
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return
  if (floatingDockDragActive) return
  if (!currentSidebarPreferences.floatingDockEnabled) return
  if (!currentFloatingDockTarget) return

  const sidebarBounds = sidebarWin.getBounds()
  const target = await getFloatingDockTargetAtEdge(sidebarBounds, currentFloatingDockTarget.side)

  if (!target) {
    currentFloatingDockMisses += 1
    if (currentFloatingDockMisses <= 12 && currentFloatingDockBounds) {
      const fallbackBounds = getDockedBoundsForTarget(
        currentFloatingDockBounds,
        currentFloatingDockTarget.side,
        currentSidebarMode,
      )
      sidebarWin.setBounds(fallbackBounds, false)
      currentFloatingPosition = { x: fallbackBounds.x, y: fallbackBounds.y }
      return
    }
    clearCurrentFloatingDockTarget()
    stopFloatingDockTracking()
    // Reflow to normal floating geometry once dock target is gone.
    applySidebarWindowMode(currentSidebarMode)
    return
  }

  currentFloatingDockMisses = 0
  currentFloatingDockTarget = target.target
  currentFloatingDockBounds = target.bounds
  const nextBounds = getDockedBoundsForTarget(target.bounds, currentFloatingDockTarget.side, currentSidebarMode)
  sidebarWin.setBounds(nextBounds, false)
  currentFloatingPosition = { x: nextBounds.x, y: nextBounds.y }
}

async function getFloatingDockTargetAtCursor(): Promise<{ target: FloatingDockTarget; bounds: Rect } | null> {
  try {
    const sidebarBounds = sidebarWin?.getBounds()
    if (!sidebarBounds) return null
    const threshold = currentSidebarPreferences.floatingDockThreshold

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
$ledgerPid = ${process.pid}
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
  $pid = 0
  [Win32]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
  if ($pid -eq $ledgerPid) { return $true }
  $rect = [Win32+RECT]::new()
  if (-not [Win32]::GetWindowRect($hWnd, [ref]$rect)) { return $true }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
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
`
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        timeout: 1200,
      })
      const [side, id, x, y, width, height] = String(stdout).trim().split('|')
      const parsed = [x, y, width, height].map((value) => Number(value))
      if (parsed.some((value) => Number.isNaN(value) || value <= 0) || !id || (side !== 'left' && side !== 'right')) {
        return null
      }
      const bounds = nativeRectToDipRect({ x: parsed[0], y: parsed[1], width: parsed[2], height: parsed[3] })
      return {
        target: {
          platform: 'win32',
          id,
          side,
        },
        bounds,
      }
    }

    if (process.platform === 'darwin') {
      const script = `
(() => {
  ObjC.import('CoreGraphics')
  var ledgerPid = ${process.pid}
  var sidebarLeft = ${Math.floor(sidebarBounds.x)}
  var sidebarTop = ${Math.floor(sidebarBounds.y)}
  var sidebarRight = ${Math.floor(sidebarBounds.x + sidebarBounds.width)}
  var sidebarBottom = ${Math.floor(sidebarBounds.y + sidebarBounds.height)}
  var sidebarHeight = ${Math.floor(sidebarBounds.height)}
  var threshold = ${Math.floor(threshold)}
  var result = ''
  var bestScore = Infinity
  var windows = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID)
  for (var i = 0; i < windows.count; i++) {
    var window = windows.objectAtIndex(i)
    var ownerPid = ObjC.unwrap(window.objectForKey('kCGWindowOwnerPID'))
    if (ownerPid === ledgerPid) continue
    var windowNumber = Number(ObjC.unwrap(window.objectForKey('kCGWindowNumber')))
    var bounds = ObjC.deepUnwrap(window.objectForKey('kCGWindowBounds'))
    if (!bounds) continue
    if (bounds.Width < 80 || bounds.Height < 80) continue

    var rectLeft = bounds.X
    var rectTop = bounds.Y
    var rectRight = bounds.X + bounds.Width
    var rectBottom = bounds.Y + bounds.Height
    var verticalOverlap = Math.max(0, Math.min(sidebarBottom, rectBottom) - Math.max(sidebarTop, rectTop))
    var verticalGap = 0
    if (sidebarBottom < rectTop) verticalGap = rectTop - sidebarBottom
    else if (sidebarTop > rectBottom) verticalGap = sidebarTop - rectBottom

    var minimumOverlap = Math.min(96, Math.max(32, Math.floor(sidebarHeight * 0.18)))
    if (verticalOverlap < minimumOverlap && verticalGap > threshold * 2) continue

    var dockLeftDistance = Math.abs(sidebarRight - rectLeft)
    var dockRightDistance = Math.abs(sidebarLeft - rectRight)
    var side = 'left'
    var edgeDistance = dockLeftDistance
    if (dockRightDistance < dockLeftDistance) {
      side = 'right'
      edgeDistance = dockRightDistance
    }
    if (edgeDistance > threshold * 2) continue

    var verticalPenalty = verticalOverlap > 0 ? 0 : verticalGap
    var score = edgeDistance + verticalPenalty * 0.5 - verticalOverlap * 0.01
    if (score < bestScore) {
      bestScore = score
      result = [side, windowNumber, bounds.X, bounds.Y, bounds.Width, bounds.Height].join('|')
    }
  }
  return result
})()
`
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        windowsHide: true,
        timeout: 1200,
      })
      const text = String(stdout).trim()
      if (!text) return null
      const [side, id, x, y, width, height] = text.split('|')
      const parsed = [x, y, width, height].map((value) => Number(value))
      if (parsed.some((value) => Number.isNaN(value) || value <= 0) || !id || (side !== 'left' && side !== 'right')) {
        return null
      }
      return {
        target: {
          platform: 'darwin',
          id,
          side,
        },
        bounds: { x: parsed[0], y: parsed[1], width: parsed[2], height: parsed[3] },
      }
    }
  } catch (error) {
    console.warn('[electron] Could not determine foreground app bounds:', error)
  }

  return null
}

async function getFloatingDockTargetAtEdge(
  sidebarBounds: Electron.Rectangle,
  side: DockSide,
): Promise<{ target: FloatingDockTarget; bounds: Rect } | null> {
  const probePoints =
    side === 'left'
      ? [{ side: 'left' as DockSide, x: sidebarBounds.x - 8, y: sidebarBounds.y + Math.floor(sidebarBounds.height / 2) }]
      : [{ side: 'right' as DockSide, x: sidebarBounds.x + sidebarBounds.width + 8, y: sidebarBounds.y + Math.floor(sidebarBounds.height / 2) }]

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
$ledgerPid = ${process.pid}
$cursor = [Win32+POINT]::new()
$cursor.X = ${Math.floor(probeX)}
$cursor.Y = ${Math.floor(probeY)}
$script:result = $null
[Win32]::EnumWindows({
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  $pid = 0
  [Win32]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
  if ($pid -eq $ledgerPid) { return $true }
  $rect = [Win32+RECT]::new()
  if (-not [Win32]::GetWindowRect($hWnd, [ref]$rect)) { return $true }
  if ($cursor.X -ge $rect.Left -and $cursor.X -le $rect.Right -and $cursor.Y -ge $rect.Top -and $cursor.Y -le $rect.Bottom) {
    $script:result = "$($hWnd.ToInt64())|$($rect.Left)|$($rect.Top)|$($rect.Right - $rect.Left)|$($rect.Bottom - $rect.Top)"
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($script:result) { Write-Output $script:result }
`
    for (const probe of probePoints) {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script(probe.x, probe.y)], {
        windowsHide: true,
        timeout: 1200,
      })
      const [id, x, y, width, height] = String(stdout).trim().split('|')
      const parsed = [x, y, width, height].map((value) => Number(value))
      if (parsed.some((value) => Number.isNaN(value) || value <= 0) || !id) continue
      return {
        target: {
          platform: 'win32',
          id,
          side: probe.side,
        },
        bounds: { x: parsed[0], y: parsed[1], width: parsed[2], height: parsed[3] },
      }
    }
    return null
  }

  if (process.platform === 'darwin') {
    const script = (probeX: number, probeY: number) => `
(() => {
  ObjC.import('CoreGraphics')
  var ledgerPid = ${process.pid}
  var windows = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID)
  for (var i = 0; i < windows.count; i++) {
    var window = windows.objectAtIndex(i)
    var ownerPid = ObjC.unwrap(window.objectForKey('kCGWindowOwnerPID'))
    if (ownerPid === ledgerPid) continue
    var windowNumber = Number(ObjC.unwrap(window.objectForKey('kCGWindowNumber')))
    var bounds = ObjC.deepUnwrap(window.objectForKey('kCGWindowBounds'))
    if (!bounds) continue
    if (${Math.floor(probeX)} >= bounds.X && ${Math.floor(probeX)} <= bounds.X + bounds.Width && ${Math.floor(probeY)} >= bounds.Y && ${Math.floor(probeY)} <= bounds.Y + bounds.Height) {
      return [windowNumber, bounds.X, bounds.Y, bounds.Width, bounds.Height].join('|')
    }
  }
  return ''
})()
`
    for (const probe of probePoints) {
      const { stdout } = await execFileAsync('osascript', ['-e', script(probe.x, probe.y)], {
        windowsHide: true,
        timeout: 1200,
      })
      const text = String(stdout).trim()
      if (!text) continue
      const [id, x, y, width, height] = text.split('|')
      const parsed = [x, y, width, height].map((value) => Number(value))
      if (parsed.some((value) => Number.isNaN(value) || value <= 0) || !id) continue
      return {
        target: {
          platform: 'darwin',
          id,
          side: probe.side,
        },
        bounds: { x: parsed[0], y: parsed[1], width: parsed[2], height: parsed[3] },
      }
    }
  }

  return null
}

async function dockFloatingSidebarToTarget() {
  if (!sidebarWin || sidebarWin.isDestroyed()) return null
  if (currentSidebarPosition !== 'floating') return null
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return null
  if (!currentSidebarPreferences.floatingDockEnabled) return null

  floatingDockDragActive = false

  // Use the cached dock target if available, otherwise query for a new one
  let target = currentFloatingDockTarget && currentFloatingDockBounds
    ? { target: currentFloatingDockTarget, bounds: currentFloatingDockBounds }
    : await getFloatingDockTargetAtCursor()

  if (!target) {
    clearCurrentFloatingDockTarget()
    stopFloatingDockTracking()
    return null
  }

  const currentBounds = sidebarWin.getBounds()
  const threshold = currentSidebarPreferences.floatingDockThreshold
  const leftDistance = Math.abs(currentBounds.x - (target.bounds.x - currentBounds.width))
  const rightDistance = Math.abs(currentBounds.x - (target.bounds.x + target.bounds.width))
  const nearestDistance = Math.min(leftDistance, rightDistance)
  if (nearestDistance > threshold * 2) {
    clearCurrentFloatingDockTarget()
    stopFloatingDockTracking()
    return null
  }

  const side = getDockSide(currentBounds, target.bounds)
  const dockBounds = getDockedBoundsForTarget(target.bounds, side, currentSidebarMode)
  const clamped = clampRectToWorkArea(dockBounds, screen.getDisplayMatching(target.bounds).workArea)

  setCurrentFloatingDockTarget({ ...target.target, side }, target.bounds)
  sidebarWin.setBounds(clamped, false)
  currentFloatingPosition = { x: clamped.x, y: clamped.y }
  if (!startFloatingDockNativeTracker({ ...target.target, side })) {
    startFloatingDockTracking()
  }
  return clamped
}

function getModuleBoundsNextToSidebar() {
  const sidebarBounds = sidebarWin?.getBounds() ?? getDockedBounds(RAIL_SIZE)
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea

  const width = Math.min(MODULE_WIDTH, workWidth - WINDOW_MARGIN * 2)
  const height = Math.min(MODULE_HEIGHT, workHeight - WINDOW_MARGIN * 2)

  let moduleX
  if (currentSidebarPosition === 'left') {
    moduleX = sidebarBounds.x + sidebarBounds.width + MODULE_GAP
    const maxX = x + workWidth - width - WINDOW_MARGIN
    if (moduleX > maxX) {
      moduleX = maxX
    }
  } else {
    moduleX = sidebarBounds.x - width - MODULE_GAP
    if (moduleX < x + WINDOW_MARGIN) {
      moduleX = x + WINDOW_MARGIN
    }
  }

  let moduleY = sidebarBounds.y
  const maxY = y + workHeight - height - WINDOW_MARGIN
  if (moduleY > maxY) moduleY = maxY
  if (moduleY < y + WINDOW_MARGIN) moduleY = y + WINDOW_MARGIN

  return { x: moduleX, y: moduleY, width, height }
}

function applySidebarWindowMode(mode: SidebarWindowMode) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return
  currentSidebarMode = mode

  if (mode === 'fullscreen') {
    floatingDockDragActive = false
    clearCurrentFloatingDockTarget()
    stopFloatingDockTracking()
    const bounds = getCenteredBounds(DASHBOARD_WIDTH, DASHBOARD_HEIGHT)
    sidebarWin.setAlwaysOnTop(false)
    sidebarWin.setResizable(true)
    setWindowButtonVisibility(sidebarWin, true)
    sidebarWin.setBounds(bounds, false)
    return
  }

  if (mode === 'auth') {
    floatingDockDragActive = false
    clearCurrentFloatingDockTarget()
    stopFloatingDockTracking()
    const bounds = getCenteredBounds(AUTH_WIDTH, AUTH_HEIGHT)
    sidebarWin.setAlwaysOnTop(false)
    sidebarWin.setResizable(false)
    setWindowButtonVisibility(sidebarWin, true)
    sidebarWin.setBounds(bounds, false)
    return
  }

  const bounds =
    currentSidebarPosition === 'floating'
      ? getFloatingBounds(mode)
      : mode === 'compact'
        ? getCollapsedBounds(COLLAPSED_SIZE)
        : mode === 'minimized'
          ? getDockedBounds(RAIL_SIZE)
          : getDockedBounds(EXPANDED_WIDTH)
  sidebarWin.setAlwaysOnTop(sidebarAlwaysOnTop, 'screen-saver')
  sidebarWin.setResizable(false)
  setWindowButtonVisibility(sidebarWin, false)
  sidebarWin.setBounds(bounds, false)
}

function applySidebarAlwaysOnTop(alwaysOnTop: boolean) {
  sidebarAlwaysOnTop = alwaysOnTop
  if (!sidebarWin || sidebarWin.isDestroyed()) return

  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') {
    sidebarWin.setAlwaysOnTop(false)
    return
  }

  sidebarWin.setAlwaysOnTop(alwaysOnTop, 'screen-saver')
}

function applySidebarOpacity(_opacity: number) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return
}

function applySidebarVisibility(isVisible: boolean) {
  if (!sidebarWin || sidebarWin.isDestroyed()) return

  sidebarIsVisible = isVisible

  if (!isVisible) {
    sidebarWin.hide()
    sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: false })
    return
  }

  sidebarWin.show()
  applySidebarWindowMode(currentSidebarMode)
  sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: true })
}

function getRendererUrl(search: string) {
  if (VITE_DEV_SERVER_URL) {
    return `${VITE_DEV_SERVER_URL}${search}`
  }
  return `file://${path.join(RENDERER_DIST, 'index.html')}${search}`
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
    },
  })

  sidebarWin.setMenuBarVisibility(false)
  sidebarWin.setMenu(null)

  lockWindowZoom(sidebarWin)

  // Keep the sidebar rendering path purely CSS-based for consistent frosted glass.

  sidebarWin.on('closed', () => {
    stopFloatingDockTracking()
    clearCurrentFloatingDockTarget()
    sidebarWin = null
    for (const [kind, moduleWin] of moduleWins.entries()) {
      if (!moduleWin.isDestroyed()) moduleWin.close()
      moduleWins.delete(kind)
    }
  })

  sidebarWin.on('close', (event) => {
    if (process.platform !== 'darwin') return
    if (currentSidebarMode !== 'fullscreen') return

    event.preventDefault()
    sidebarWin?.webContents.send('sidebar:state-changed', { state: 'minimized' })
    applySidebarWindowMode('minimized')
  })

  try {
    const rendererUrl = VITE_DEV_SERVER_URL
      ? VITE_DEV_SERVER_URL
      : `file://${path.join(RENDERER_DIST, 'index.html')}`
    if (VITE_DEV_SERVER_URL) {
      sidebarWin.loadURL(rendererUrl)
    } else {
      sidebarWin.loadFile(path.join(RENDERER_DIST, 'index.html'))
    }
  } catch (err) {
    console.error('[electron] Error while loading sidebar renderer:', err)
  }
}

function sendModuleFocus(
  kind: ModuleWindowKind,
  focusDate?: string | null,
  focusProjectId?: string | null,
  focusNoteId?: string | null,
  focusTaskId?: string | null
) {
  const existing = moduleWins.get(kind)
  if (existing && !existing.isDestroyed()) {
    if (focusDate) {
      existing.webContents.send('module:focus-date', { kind, focusDate })
    }
    if (focusProjectId) {
      existing.webContents.send('module:focus-project', { kind, focusProjectId })
    }
    if (focusNoteId) {
      existing.webContents.send('module:focus-note', { kind, focusNoteId })
    }
    if (focusTaskId) {
      existing.webContents.send('module:focus-task', { kind, focusTaskId })
    }
  }
}

function openModuleWindow(
  kind: ModuleWindowKind,
  focusDate?: string | null,
  focusProjectId?: string | null,
  focusNoteId?: string | null,
  focusTaskId?: string | null
) {
  const existing = moduleWins.get(kind)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    sendModuleFocus(kind, focusDate, focusProjectId, focusNoteId, focusTaskId)
    return
  }

  const moduleWin = new BrowserWindow({
    ...getModuleBoundsNextToSidebar(),
    transparent: true,
    ...getModuleWindowChromeOptions(),
    minWidth: 1080,
    minHeight: 680,
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  moduleWin.setMenuBarVisibility(false)
  moduleWin.setMenu(null)

  // Apply subtle vibrancy to module windows
  if (process.platform === 'darwin') {
    moduleWin.setVibrancy('content')
  }

  if (process.platform === 'win32') {
    moduleWin.setBackgroundMaterial('auto')
  }

  lockWindowZoom(moduleWin)

  moduleWins.set(kind, moduleWin)

  moduleWin.on('minimize', () => {
    sidebarWin?.webContents.send('module:state-changed', { kind, state: 'minimized' })
  })

  moduleWin.on('close', () => {
    sidebarWin?.webContents.send('module:state-changed', { kind, state: 'closed' })
  })

  moduleWin.on('closed', () => {
    moduleWins.delete(kind)
  })

  const focusDateQuery = focusDate ? `&focusDate=${encodeURIComponent(focusDate)}` : ''
  const focusProjectQuery = focusProjectId ? `&focusProjectId=${encodeURIComponent(focusProjectId)}` : ''
  const focusNoteQuery = focusNoteId ? `&focusNoteId=${encodeURIComponent(focusNoteId)}` : ''
  const focusTaskQuery = focusTaskId ? `&focusTaskId=${encodeURIComponent(focusTaskId)}` : ''
  moduleWin.webContents.once('did-finish-load', () => sendModuleFocus(kind, focusDate, focusProjectId, focusNoteId, focusTaskId))
  try {
    const moduleUrl = getRendererUrl(`?window=module&module=${kind}${focusDateQuery}${focusProjectQuery}${focusNoteQuery}${focusTaskQuery}`)
    moduleWin.loadURL(moduleUrl)
  } catch (err) {
    console.error('[electron] Error while loading module renderer:', err)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('activate', () => {
  if (!sidebarWin || sidebarWin.isDestroyed()) {
    createSidebarWindow()
    return
  }

  if (sidebarWin.isVisible()) return

  sidebarWin.show()
  applySidebarWindowMode(currentSidebarMode)
  sidebarWin.webContents.send('sidebar:visibility-changed', { isVisible: true })
})

ipcMain.handle('window:set-mode', (_event, mode: SidebarWindowMode) => {
  applySidebarWindowMode(mode)
})

ipcMain.handle('window:set-visible', (_event, isVisible: boolean) => {
  applySidebarVisibility(isVisible)
})

ipcMain.handle('window:hide-temporary', () => {
  if (!sidebarWin || sidebarWin.isDestroyed()) return
  sidebarWin.hide()
})

ipcMain.handle('window:set-always-on-top', (_event, alwaysOnTop: boolean) => {
  applySidebarAlwaysOnTop(alwaysOnTop)
})

ipcMain.handle('window:apply-sidebar-preferences', (_event, preferences: SidebarPreferencesPayload) => {
  if (!sidebarWin || sidebarWin.isDestroyed()) return
  const previousSidebarPosition = currentSidebarPosition

  if (preferences.position === 'left' || preferences.position === 'right') {
    currentSidebarPosition = preferences.position
    clearCurrentFloatingDockTarget()
    stopFloatingDockTracking()
  } else if (preferences.position === 'floating') {
    currentSidebarPosition = 'floating'
    if (previousSidebarPosition !== 'floating') {
      clearCurrentFloatingDockTarget()
      stopFloatingDockTracking()
    }
  } else {
    clearCurrentFloatingDockTarget()
    stopFloatingDockTracking()
  }
  if (typeof preferences.opacity === 'number') {
    applySidebarOpacity(preferences.opacity)
  }
  if (preferences.floatingPosition) {
    currentFloatingPosition = {
      x: preferences.floatingPosition.x,
      y: preferences.floatingPosition.y,
    }
  }
  if (preferences.floatingDockEnabled === false) {
    clearCurrentFloatingDockTarget()
    stopFloatingDockTracking()
    // Ensure we don't keep stale dock-shaped bounds after dock is disabled.
    applySidebarWindowMode(currentSidebarMode)
  }
  currentSidebarPreferences = {
    ...currentSidebarPreferences,
    ...preferences,
  }
  sidebarWin.webContents.send('sidebar:preferences-updated', preferences)
  if (currentSidebarMode !== 'auth' && currentSidebarMode !== 'fullscreen') {
    applySidebarWindowMode(currentSidebarMode)
    if (
      currentSidebarPosition === 'floating' &&
      currentFloatingDockTarget &&
      currentSidebarPreferences.floatingDockEnabled !== false
    ) {
      if (!floatingDockNativeTracker && !startFloatingDockNativeTracker(currentFloatingDockTarget)) {
        startFloatingDockTracking()
      }
    }
  }
})

ipcMain.handle('window:set-floating-position', (_event, floatingPosition: { x: number; y: number }) => {
  currentFloatingPosition = {
    x: floatingPosition.x,
    y: floatingPosition.y,
  }

  if (!sidebarWin || sidebarWin.isDestroyed()) return
  if (currentSidebarPosition !== 'floating') return
  if (currentSidebarMode === 'auth' || currentSidebarMode === 'fullscreen') return

  sidebarWin.setPosition(floatingPosition.x, floatingPosition.y, false)
})

ipcMain.handle('window:begin-floating-drag', () => {
  floatingDockDragActive = true
  clearCurrentFloatingDockTarget()
  stopFloatingDockTracking()

  // Return the actual current bounds so React can calculate delta correctly
  if (!sidebarWin || sidebarWin.isDestroyed()) return { x: 0, y: 0 }
  const bounds = sidebarWin.getBounds()
  return { x: bounds.x, y: bounds.y }
})

ipcMain.handle('window:dock-floating-window', async () => {
  return dockFloatingSidebarToTarget()
})

ipcMain.handle('window:detach-floating-window', () => {
  floatingDockDragActive = false
  clearCurrentFloatingDockTarget()
  stopFloatingDockTracking()
  return null
})

ipcMain.handle('window:toggle-module', (_event, payload: ModuleWindowKind | ModuleFocusPayload) => {
  const kind = typeof payload === 'string' ? payload : payload.kind
  const focusDate = typeof payload === 'string' ? undefined : payload.focusDate
  const focusProjectId = typeof payload === 'string' ? undefined : payload.focusProjectId
  const focusNoteId = typeof payload === 'string' ? undefined : payload.focusNoteId
  const focusTaskId = typeof payload === 'string' ? undefined : payload.focusTaskId
  const existing = moduleWins.get(kind)

  if (existing && !existing.isDestroyed()) {
    if (focusDate || focusProjectId || focusNoteId || focusTaskId) {
      if (existing.isMinimized()) {
        existing.restore()
      }
      existing.show()
      existing.focus()
      sendModuleFocus(kind, focusDate, focusProjectId, focusNoteId, focusTaskId)
      return
    }

    if (existing.isMinimized()) {
      existing.restore()
      existing.focus()
      return
    }

    if (existing.isVisible()) {
      existing.minimize()
      return
    }

    existing.show()
    existing.focus()
    return
  }

  openModuleWindow(kind, focusDate, focusProjectId, focusNoteId, focusTaskId)
})

ipcMain.handle('window:open-external', async (_event, url: string) => {
  if (!/^https?:\/\//i.test(url) && !/^webcal:\/\//i.test(url)) {
    throw new Error('Unsupported external URL protocol')
  }
  await shell.openExternal(url)
})

app.whenReady().then(() => {
  createSidebarWindow()

  const toggleSidebarShortcut = process.platform === 'darwin' ? 'Cmd+Shift+B' : 'Ctrl+Shift+B'
  const registered = globalShortcut.register(toggleSidebarShortcut, () => {
    applySidebarVisibility(!sidebarIsVisible)
  })

  if (!registered) {
    console.warn(`[electron] Failed to register sidebar shortcut: ${toggleSidebarShortcut}`)
  }
})
