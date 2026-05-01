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
type ModuleWindowKind = 'calendar'

let sidebarWin: BrowserWindow | null = null
const moduleWins = new Map<ModuleWindowKind, BrowserWindow>()

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

  sidebarWin.on('closed', () => {
    sidebarWin = null
    for (const [kind, moduleWin] of moduleWins.entries()) {
      if (!moduleWin.isDestroyed()) moduleWin.close()
      moduleWins.delete(kind)
    }
  })

  if (VITE_DEV_SERVER_URL) {
    sidebarWin.loadURL(VITE_DEV_SERVER_URL)
  } else {
    sidebarWin.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function openModuleWindow(kind: ModuleWindowKind) {
  const existing = moduleWins.get(kind)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }

  const moduleWin = new BrowserWindow({
    ...getModuleBoundsNextToSidebar(),
    titleBarStyle: 'hiddenInset',
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

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

  moduleWin.loadURL(getRendererUrl(`?window=module&module=${kind}`))
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

ipcMain.handle('window:toggle-module', (_event, kind: ModuleWindowKind) => {
  const existing = moduleWins.get(kind)

  if (existing && !existing.isDestroyed()) {
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

  openModuleWindow(kind)
})

ipcMain.handle('window:open-external', async (_event, url: string) => {
  if (!/^https?:\/\//i.test(url) && !/^webcal:\/\//i.test(url)) {
    throw new Error('Unsupported external URL protocol')
  }
  await shell.openExternal(url)
})

app.whenReady().then(createSidebarWindow)
