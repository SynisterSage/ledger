import { spawn } from 'node:child_process'

const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173/'
const electronCommand = process.platform === 'win32' ? 'electron.cmd' : 'electron'

const child = spawn(electronCommand, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl,
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
  console.error('[dev:electron] Failed to start Electron:', error)
  exit(1)
})

child.on('exit', (code) => {
  exit(code ?? 0)
})
