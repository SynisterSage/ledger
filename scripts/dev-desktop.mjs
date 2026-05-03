import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const viteEntry = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')

function loadDotEnv(envPath) {
  try {
    const content = fs.readFileSync(envPath, 'utf8')
    const out = {}
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1)
      } else if (val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1)
      }
      out[key] = val
    }
    return out
  } catch (err) {
    return {}
  }
}

const loadedEnv = loadDotEnv(path.join(process.cwd(), '.env.local'))

const child = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', '5173'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...loadedEnv,
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
  console.error('[dev:desktop] Failed to start Vite:', error)
  exit(1)
})

child.on('exit', (code) => {
  exit(code ?? 0)
})
