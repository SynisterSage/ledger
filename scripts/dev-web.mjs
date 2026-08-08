import { spawn } from 'node:child_process';
import path from 'node:path';

const viteEntry = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

const child = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', '5173'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_LAUNCH_ELECTRON: '0',
    // Keep browser development same-origin with Vite. The proxy forwards API
    // requests without asking the production backend to trust localhost.
    VITE_API_URL: 'http://127.0.0.1:5173',
    LEDGER_DEV_TARGET: 'web',
  },
});

const exit = (code = 0) => {
  if (!child.killed) {
    child.kill();
  }
  process.exit(code);
};

process.on('SIGINT', () => exit(0));
process.on('SIGTERM', () => exit(0));

child.on('error', (error) => {
  console.error('[dev:web] Failed to start Vite:', error);
  exit(1);
});

child.on('exit', (code) => {
  exit(code ?? 0);
});
