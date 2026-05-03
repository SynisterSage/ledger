import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173/'
const viteCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const electronCommand = process.platform === 'win32' ? 'electron.cmd' : 'electron'

const renderer = spawn(viteCommand, ['run', 'dev:web'], {
  stdio: 'inherit',
  env: process.env,
})

let electron = null

const stopRenderer = () => {
  if (!renderer.killed) {
    renderer.kill()
  }
}

const waitForRenderer = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(devServerUrl, { method: 'HEAD' })
      if (response.ok || response.status === 405) {
        return
      }
    } catch {
      // Keep waiting until Vite is ready.
    }
    await delay(500)
  }
  throw new Error(`Timed out waiting for Vite at ${devServerUrl}`)
}

const exit = (code = 0) => {
  stopRenderer()
  if (electron && !electron.killed) {
    electron.kill()
  }
  process.exit(code)
}

process.on('SIGINT', () => exit(0))
process.on('SIGTERM', () => exit(0))

renderer.on('error', (error) => {
  console.error('[dev:desktop] Failed to start Vite:', error)
  exit(1)
})

renderer.on('exit', (code) => {
  if (code && code !== 0) {
    exit(code)
  }
})

try {
  await waitForRenderer()
  electron = spawn(electronCommand, ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl,
    },
  })

  electron.on('error', (error) => {
    console.error('[dev:desktop] Failed to start Electron:', error)
    exit(1)
  })

  electron.on('exit', (code) => {
    exit(code ?? 0)
  })
} catch (error) {
  console.error('[dev:desktop]', error instanceof Error ? error.message : error)
  exit(1)
}
