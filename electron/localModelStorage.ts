import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const electronModule = createRequire(import.meta.url)('electron') as { app?: { getPath(name: string): string } };

const appUserData = () => electronModule.app?.getPath('userData') ?? path.join(process.cwd(), '.ledger-ai-test-data');
const preferencePath = () => path.join(appUserData(), 'local-model-storage.json');

/** The selected directory is a parent for Ledger's local model folders. */
export const defaultLocalModelStorageRoot = () => appUserData();

export const getLocalModelStorageRoot = () => {
  try {
    const value = JSON.parse(fs.readFileSync(preferencePath(), 'utf8')) as { root?: unknown };
    if (typeof value.root === 'string' && path.isAbsolute(value.root) && value.root.trim()) return path.resolve(value.root);
  } catch { /* Use the application-data default when the preference is absent/corrupt. */ }
  return defaultLocalModelStorageRoot();
};

export const setLocalModelStorageRoot = async (root: string) => {
  const candidate = root.trim();
  if (!candidate || !path.isAbsolute(candidate)) throw new Error('Choose an absolute folder for local models.');
  const resolved = path.resolve(candidate);
  await fs.promises.mkdir(resolved, { recursive: true });
  const probe = path.join(resolved, `.ledger-model-storage-${process.pid}-${Date.now()}.tmp`);
  await fs.promises.writeFile(probe, 'ok', { mode: 0o600 });
  await fs.promises.rm(probe, { force: true });
  await fs.promises.mkdir(appUserData(), { recursive: true });
  await fs.promises.writeFile(preferencePath(), JSON.stringify({ root: resolved, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  return { root: resolved };
};

export const localModelPath = (...segments: string[]) => path.join(getLocalModelStorageRoot(), ...segments);
