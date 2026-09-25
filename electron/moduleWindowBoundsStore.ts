import fs from 'node:fs';
import path from 'node:path';

export type StoredModuleWindowBounds = {
  bounds: { x: number; y: number; width: number; height: number };
  sidebarPosition: string;
};

type StoreFile = {
  version: 1;
  windows: Record<string, StoredModuleWindowBounds>;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStoredBounds = (value: unknown): value is StoredModuleWindowBounds => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredModuleWindowBounds>;
  const bounds = candidate.bounds;
  return Boolean(
    bounds &&
      isFiniteNumber(bounds.x) &&
      isFiniteNumber(bounds.y) &&
      isFiniteNumber(bounds.width) &&
      isFiniteNumber(bounds.height) &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      typeof candidate.sidebarPosition === 'string'
  );
};

export class ModuleWindowBoundsStore {
  private readonly filePath: string;
  private windows: Record<string, StoredModuleWindowBounds> = {};

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'module-window-bounds.json');
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<StoreFile>;
      if (parsed.version !== 1 || !parsed.windows || typeof parsed.windows !== 'object') return;
      this.windows = Object.fromEntries(
        Object.entries(parsed.windows).filter(([, value]) => isStoredBounds(value))
      ) as Record<string, StoredModuleWindowBounds>;
    } catch {
      this.windows = {};
    }
  }

  get(kind: string) {
    return this.windows[kind] ?? null;
  }

  set(kind: string, value: StoredModuleWindowBounds) {
    this.windows[kind] = value;
  }

  flush() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      fs.writeFileSync(
        temporaryPath,
        JSON.stringify({ version: 1, windows: this.windows }, null, 2),
        { mode: 0o600 }
      );
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      console.warn('[electron] Failed to persist module window bounds:', error);
    }
  }
}
