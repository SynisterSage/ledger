import { app, BrowserWindow, ipcMain, screen, shell, globalShortcut } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defaultSidebarPreferences } from '../src/config/sidebarPreferences'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

let sidebarWin: BrowserWindow | null = null
const moduleWins = new Map<ModuleWindowKind, BrowserWindow>()
let currentSidebarMode: SidebarWindowMode = 'auth'
let currentSidebarPosition: 'left' | 'right' | 'floating' = 'right'
let currentFloatingPosition = { ...defaultSidebarPreferences.floatingPosition }
let sidebarIsVisible = true
let sidebarAlwaysOnTop = true

const WINDOW_MARGIN = 16
const RAIL_SIZE = 64
const COLLAPSED_SIZE = 64
const EXPANDED_WIDTH = 320
const DASHBOARD_WIDTH = 1280
const DASHBOARD_HEIGHT = 860
const AUTH_WIDTH = 520
const AUTH_HEIGHT = 700
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

  if (position === 'left') {
    return {
      x: x + WINDOW_MARGIN,
      y: y + WINDOW_MARGIN,
      width,
      height: workHeight - WINDOW_MARGIN * 2,
    }
  }

  return {
    x: x + workWidth - width - WINDOW_MARGIN,
    y: y + WINDOW_MARGIN,
    width,
    height: workHeight - WINDOW_MARGIN * 2,
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
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea

  if (mode === 'compact') {
    const size = Math.min(COLLAPSED_SIZE, workWidth - WINDOW_MARGIN * 2, workHeight - WINDOW_MARGIN * 2)
    return {
      x: currentFloatingPosition.x,
      y: currentFloatingPosition.y,
      width: size,
      height: size,
    }
  }

  const width = Math.min(mode === 'minimized' ? RAIL_SIZE : EXPANDED_WIDTH, workWidth - WINDOW_MARGIN * 2)
  const height = Math.min(workHeight - WINDOW_MARGIN * 2, workHeight - WINDOW_MARGIN * 2)

  return {
    x: currentFloatingPosition.x,
    y: currentFloatingPosition.y,
    width,
    height,
  }
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
    const bounds = getCenteredBounds(DASHBOARD_WIDTH, DASHBOARD_HEIGHT)
    sidebarWin.setAlwaysOnTop(false)
    sidebarWin.setResizable(true)
    setWindowButtonVisibility(sidebarWin, true)
    sidebarWin.setBounds(bounds, false)
    return
  }

  if (mode === 'auth') {
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

ipcMain.handle('window:set-always-on-top', (_event, alwaysOnTop: boolean) => {
  applySidebarAlwaysOnTop(alwaysOnTop)
})

ipcMain.handle('window:apply-sidebar-preferences', (_event, preferences: SidebarPreferencesPayload) => {
  if (!sidebarWin || sidebarWin.isDestroyed()) return
  if (preferences.position === 'left' || preferences.position === 'right') {
    currentSidebarPosition = preferences.position
  } else if (preferences.position === 'floating') {
    currentSidebarPosition = 'floating'
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
  sidebarWin.webContents.send('sidebar:preferences-updated', preferences)
  if (currentSidebarMode !== 'auth' && currentSidebarMode !== 'fullscreen') {
    applySidebarWindowMode(currentSidebarMode)
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
