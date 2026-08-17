import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const platform = process.env.LEDGER_RELEASE_PLATFORM || process.platform;
const arch = process.env.LEDGER_RELEASE_ARCH || process.arch;
const executable = platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const runtime = path.join(root, 'native', 'local-ai-runtime', `${platform}-${arch}`, executable);

if (platform !== 'darwin' && platform !== 'win32') throw new Error(`Local AI release verification does not support ${platform}.`);
if (!fs.existsSync(runtime)) throw new Error(`Missing pinned llama-server runtime: ${runtime}`);
if (platform !== 'win32' && (fs.statSync(runtime).mode & 0o111) === 0) throw new Error(`Runtime is not executable: ${runtime}`);

const required = [
  'LEDGER_LOCAL_AI_GENERATION_URL',
  'LEDGER_LOCAL_AI_GENERATION_SIZE',
  'LEDGER_LOCAL_AI_GENERATION_SHA256',
  'LEDGER_LOCAL_AI_EMBEDDING_URL',
  'LEDGER_LOCAL_AI_EMBEDDING_SIZE',
  'LEDGER_LOCAL_AI_EMBEDDING_SHA256',
];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error(`Missing verified Local AI artifact metadata: ${missing.join(', ')}`);

console.log(`Local AI release inputs present for ${platform}-${arch}: ${runtime}`);
