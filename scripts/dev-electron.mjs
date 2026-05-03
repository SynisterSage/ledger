import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

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

const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173/'
const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const loadedEnv = loadDotEnv(path.join(process.cwd(), '.env.local'))

const child = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...loadedEnv,
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
