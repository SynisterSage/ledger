import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';

export type LocalCaptureRetention = 'delete_after_processing' | 'retain_until_deleted';

export type LocalCapturePrivacyPreferences = {
  scanImageRetention: LocalCaptureRetention;
};

const DEFAULTS: LocalCapturePrivacyPreferences = { scanImageRetention: 'delete_after_processing' };

export class LocalCapturePrivacyStore {
  private readonly root = path.join(app.getPath('userData'), 'local-capture');
  private readonly preferencesPath = path.join(this.root, 'preferences.json');

  constructor() {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  preferences(): LocalCapturePrivacyPreferences {
    try {
      const value = JSON.parse(fs.readFileSync(this.preferencesPath, 'utf8')) as Partial<LocalCapturePrivacyPreferences>;
      return {
        scanImageRetention: value.scanImageRetention === 'retain_until_deleted'
          ? 'retain_until_deleted'
          : DEFAULTS.scanImageRetention,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  setPreferences(next: Partial<LocalCapturePrivacyPreferences>) {
    const preferences = {
      ...this.preferences(),
      ...(next.scanImageRetention === 'retain_until_deleted' || next.scanImageRetention === 'delete_after_processing'
        ? { scanImageRetention: next.scanImageRetention }
        : {}),
    };
    const temporary = `${this.preferencesPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(preferences, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.preferencesPath);
    return preferences;
  }

  async retainScan(sourcePath: string) {
    if (this.preferences().scanImageRetention !== 'retain_until_deleted') return null;
    const scans = path.join(this.root, 'scanned-images');
    await fs.promises.mkdir(scans, { recursive: true, mode: 0o700 });
    const extension = path.extname(sourcePath).toLowerCase() || '.bin';
    const destination = path.join(scans, `${randomUUID()}${extension}`);
    await fs.promises.copyFile(sourcePath, destination);
    return destination;
  }

  async deleteLocalCaptureData() {
    const deleted: string[] = [];
    const scanRoot = path.join(this.root, 'scanned-images');
    if (fs.existsSync(scanRoot)) {
      await fs.promises.rm(scanRoot, { recursive: true, force: true });
      deleted.push('scanned-images');
    }
    return { ok: true, deleted };
  }
}
