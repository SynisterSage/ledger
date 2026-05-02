import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

type SidebarWindowMode = 'auth' | 'minimized' | 'expanded' | 'fullscreen'
type ModuleWindowKind = 'calendar' | 'notes' | 'projects'
type ModuleFocusPayload = {
  kind: ModuleWindowKind
  focusDate?: string | null
}

let sidebarWin: BrowserWindow | null = null
const moduleWins = new Map<ModuleWindowKind, BrowserWindow>()
let currentSidebarMode: SidebarWindowMode = 'auth'

const WINDOW_MARGIN = 16
const MINIMIZED_WIDTH = 64
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

function getDockedBounds(width: number) {
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea
  return {
    x: x + workWidth - width - WINDOW_MARGIN,
    y: y + WINDOW_MARGIN,
    width,
    height: workHeight - WINDOW_MARGIN * 2,
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
  const sidebarBounds = sidebarWin?.getBounds() ?? getDockedBounds(MINIMIZED_WIDTH)
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea

  const width = Math.min(MODULE_WIDTH, workWidth - WINDOW_MARGIN * 2)
  const height = Math.min(MODULE_HEIGHT, workHeight - WINDOW_MARGIN * 2)

  let moduleX = sidebarBounds.x - width - MODULE_GAP
  if (moduleX < x + WINDOW_MARGIN) {
    moduleX = x + WINDOW_MARGIN
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
    sidebarWin.setWindowButtonVisibility(true)
    sidebarWin.setBounds(bounds, false)
    return
  }

  if (mode === 'auth') {
    const bounds = getCenteredBounds(AUTH_WIDTH, AUTH_HEIGHT)
    sidebarWin.setAlwaysOnTop(false)
    sidebarWin.setResizable(false)
    sidebarWin.setWindowButtonVisibility(true)
    sidebarWin.setBounds(bounds, false)
    return
  }

  const width = mode === 'minimized' ? MINIMIZED_WIDTH : EXPANDED_WIDTH
  const bounds = getDockedBounds(width)
  sidebarWin.setAlwaysOnTop(true, 'screen-saver')
  sidebarWin.setResizable(false)
  sidebarWin.setWindowButtonVisibility(false)
  sidebarWin.setBounds(bounds, false)
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
    resizable: false,
    alwaysOnTop: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  lockWindowZoom(sidebarWin)

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

  if (VITE_DEV_SERVER_URL) {
    sidebarWin.loadURL(VITE_DEV_SERVER_URL)
  } else {
    sidebarWin.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function sendModuleFocusDate(kind: ModuleWindowKind, focusDate?: string | null) {
  if (!focusDate) return
  const existing = moduleWins.get(kind)
  if (existing && !existing.isDestroyed()) {
    existing.webContents.send('module:focus-date', { kind, focusDate })
  }
}

function openModuleWindow(kind: ModuleWindowKind, focusDate?: string | null) {
  const existing = moduleWins.get(kind)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    sendModuleFocusDate(kind, focusDate)
    return
  }

  const moduleWin = new BrowserWindow({
    ...getModuleBoundsNextToSidebar(),
    transparent: true,
    titleBarStyle: 'hiddenInset',
    minWidth: 1080,
    minHeight: 680,
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

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
  moduleWin.webContents.once('did-finish-load', () => sendModuleFocusDate(kind, focusDate))
  moduleWin.loadURL(getRendererUrl(`?window=module&module=${kind}${focusDateQuery}`))
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createSidebarWindow()
  }
})

ipcMain.handle('window:set-mode', (_event, mode: SidebarWindowMode) => {
  applySidebarWindowMode(mode)
})

ipcMain.handle('window:toggle-module', (_event, payload: ModuleWindowKind | ModuleFocusPayload) => {
  const kind = typeof payload === 'string' ? payload : payload.kind
  const focusDate = typeof payload === 'string' ? undefined : payload.focusDate
  const existing = moduleWins.get(kind)

  if (existing && !existing.isDestroyed()) {
    if (focusDate) {
      if (existing.isMinimized()) {
        existing.restore()
      }
      existing.show()
      existing.focus()
      sendModuleFocusDate(kind, focusDate)
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

  openModuleWindow(kind, focusDate)
})

ipcMain.handle('window:open-external', async (_event, url: string) => {
  if (!/^https?:\/\//i.test(url) && !/^webcal:\/\//i.test(url)) {
    throw new Error('Unsupported external URL protocol')
  }
  await shell.openExternal(url)
})

app.whenReady().then(createSidebarWindow)
