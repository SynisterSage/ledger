import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const electronModule = createRequire(import.meta.url)('electron') as { app?: { getPath(name: string): string } };

const appUserData = () => electronModule.app?.getPath('userData') ?? path.join(process.cwd(), '.ledger-ai-test-data');
const preferencePath = () => path.join(appUserData(), 'local-model-storage.json');
const readPreference = () => {
  try { return JSON.parse(fs.readFileSync(preferencePath(), 'utf8')) as { root?: unknown; previousRoots?: unknown }; }
  catch { return {}; }
};

/** The selected directory is a parent for Ledger's local model folders. */
export const defaultLocalModelStorageRoot = () => appUserData();

export const getLocalModelStorageRoot = () => {
  const value = readPreference();
  if (typeof value.root === 'string' && path.isAbsolute(value.root) && value.root.trim()) return path.resolve(value.root);
  return defaultLocalModelStorageRoot();
};

/**
 * The selected root is authoritative for new downloads, but older installs
 * may still have models in the original app-data root. Keep that root as a
 * read-only fallback so changing storage does not make installed models
 * disappear from the runtime or settings.
 */
export const getLocalModelStorageRoots = () => {
  const selected = getLocalModelStorageRoot();
  const fallback = defaultLocalModelStorageRoot();
  const previous = readPreference().previousRoots;
  const previousRoots = Array.isArray(previous) ? previous.filter((root): root is string => typeof root === 'string' && path.isAbsolute(root) && Boolean(root.trim())).map((root) => path.resolve(root)) : [];
  return [...new Set([selected, ...previousRoots, fallback])];
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
  const current = getLocalModelStorageRoot();
  const previous = readPreference().previousRoots;
  const previousRoots = Array.isArray(previous) ? previous.filter((value): value is string => typeof value === 'string' && path.isAbsolute(value) && Boolean(value.trim())).map((value) => path.resolve(value)) : [];
  const priorRoots = current === resolved ? previousRoots : [current, ...previousRoots];
  await fs.promises.writeFile(preferencePath(), JSON.stringify({ root: resolved, previousRoots: [...new Set(priorRoots)], updatedAt: new Date().toISOString() }), { mode: 0o600 });
  return { root: resolved };
};

export const localModelPath = (...segments: string[]) => path.join(getLocalModelStorageRoot(), ...segments);
export const localModelPathCandidates = (...segments: string[]) => getLocalModelStorageRoots().map((root) => path.join(root, ...segments));
