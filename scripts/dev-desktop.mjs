import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeCommand = process.execPath
const launcherPath = path.join(__dirname, 'dev-web.mjs')

const child = spawn(nodeCommand, [launcherPath], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_LAUNCH_ELECTRON: '1',
  },
})

const exit = (code = 0) => {
  if (!child.killed) {
    child.kill()
  }
  process.exit(code)
}

process.on('SIGINT', () => exit(0))
process.on('SIGTERM', () => exit(0))

child.on('error', (error) => {
  console.error('[dev:desktop] Failed to start launcher:', error)
  exit(1)
})

child.on('exit', (code) => {
  exit(code ?? 0)
})
