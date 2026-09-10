import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'apps/mobile/modules/ledger-note-ocr/android/src/main/assets/models');
const manifest = await readFile(resolve(root, 'SHA256SUMS'), 'utf8');
const failures = [];

for (const line of manifest.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
  const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
  if (!match) { failures.push(`Invalid checksum entry: ${line}`); continue; }
  const [, expected, relativePath] = match;
  try {
    const digest = createHash('sha256').update(await readFile(resolve(root, relativePath))).digest('hex');
    if (digest !== expected.toLowerCase()) failures.push(`${relativePath}: checksum mismatch`);
  } catch (error) {
    failures.push(`${relativePath}: ${error instanceof Error ? error.message : 'missing asset'}`);
  }
}

if (failures.length) {
  console.error(['Note OCR asset verification failed:', ...failures].join('\n'));
  process.exitCode = 1;
} else {
  console.log('Note OCR Android assets verified.');
}
