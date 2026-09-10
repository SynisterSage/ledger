import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  LocalContextFile,
  LocalContextFileStatus,
  LocalContextLink,
  LocalContextLibrarySummary,
  LocalContextTargetType,
} from '../src/types/localContextLibrary.ts';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const SUPPORTED = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['csv', 'text/csv'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

const extensionFor = (name: string) => path.extname(name).slice(1).toLowerCase();
const now = () => new Date().toISOString();
const manifestName = (id: string) => `${id}.json`;
const fileName = (id: string, extension: string) => `${id}.${extension}`;

const isWithinRoot = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

type LocalContextManifest = LocalContextFile;

export class LocalContextLibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalContextLibraryError';
  }
}

export class LocalContextLibrary {
  private readonly root: string;
  private readonly records = new Map<string, LocalContextFile>();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  private async writeManifest(record: LocalContextFile) {
    const temporary = path.join(this.root, `${record.id}.json.tmp`);
    await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(temporary, path.join(this.root, manifestName(record.id)));
  }

  private validateOwnerAndWorkspace(record: LocalContextFile, ownerUserId: string, workspaceId: string) {
    if (record.ownerUserId !== ownerUserId || record.workspaceId !== workspaceId) {
      throw new LocalContextLibraryError('Local file is not available in this workspace.');
    }
  }

  private async loadRecord(id: string) {
    const cached = this.records.get(id);
    if (cached) return cached;
    await this.ensureRoot();
    let record: LocalContextManifest;
    try {
      record = JSON.parse(await fs.readFile(path.join(this.root, manifestName(id)), 'utf8')) as LocalContextManifest;
    } catch {
      return null;
    }
    if (!record || record.id !== id || !isWithinRoot(this.root, path.resolve(this.root, record.relativePath))) return null;
    const absolutePath = path.resolve(this.root, record.relativePath);
    const exists = await fs.stat(absolutePath).then((value) => value.isFile()).catch(() => false);
    if (!exists && record.status !== 'missing') {
      record = { ...record, status: 'missing' };
    }
    this.records.set(id, record);
    return record;
  }

  async importFiles(paths: string[], ownerUserId: string, workspaceId: string): Promise<LocalContextFile[]> {
    if (!ownerUserId.trim() || !workspaceId.trim()) throw new LocalContextLibraryError('Account and workspace are required.');
    if (!paths.length) return [];
    await this.ensureRoot();
    const imported: LocalContextFile[] = [];
    const existing = await this.list(ownerUserId, workspaceId);
    const existingByHash = new Map(existing.map((record) => [record.contentHash, record]));

    for (const sourcePath of paths) {
      const originalPath = path.resolve(sourcePath);
      const source = await fs.stat(originalPath).catch(() => null);
      if (!source?.isFile()) throw new LocalContextLibraryError('Only regular files can be imported.');
      if (source.size > MAX_FILE_BYTES) throw new LocalContextLibraryError('Each local file must be 50 MB or smaller.');
      const name = path.basename(originalPath);
      const extension = extensionFor(name);
      const mimeType = SUPPORTED.get(extension);
      if (!mimeType) throw new LocalContextLibraryError(`Unsupported local file type: .${extension || 'unknown'}.`);
      const bytes = await fs.readFile(originalPath);
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const duplicate = existingByHash.get(contentHash);
      if (duplicate) {
        const updated = { ...duplicate, lastUsedAt: now(), updatedAt: now() };
        this.records.set(updated.id, updated);
        await this.writeManifest(updated);
        imported.push(updated);
        continue;
      }

      const id = randomUUID();
      const relativePath = fileName(id, extension);
      await fs.copyFile(originalPath, path.join(this.root, relativePath));
      await fs.chmod(path.join(this.root, relativePath), 0o600);
      const timestamp = now();
      const record: LocalContextFile = {
        id,
        ownerUserId,
        workspaceId,
        name,
        extension,
        mimeType,
        sizeBytes: bytes.byteLength,
        contentHash,
        status: 'ready',
        relativePath,
        createdAt: timestamp,
        updatedAt: timestamp,
        links: [],
      };
      this.records.set(id, record);
      existingByHash.set(contentHash, record);
      await this.writeManifest(record);
      imported.push(record);
    }
    return imported;
  }

  async list(ownerUserId: string, workspaceId: string): Promise<LocalContextFile[]> {
    await this.ensureRoot();
    const names = await fs.readdir(this.root);
    const records = await Promise.all(
      names.filter((name) => name.endsWith('.json')).map((name) => this.loadRecord(name.slice(0, -5)))
    );
    return records
      .filter((record): record is LocalContextFile => Boolean(record))
      .filter((record) => record.ownerUserId === ownerUserId && record.workspaceId === workspaceId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async summary(ownerUserId: string, workspaceId: string): Promise<LocalContextLibrarySummary> {
    const files = await this.list(ownerUserId, workspaceId);
    return { files, totalBytes: files.reduce((total, record) => total + record.sizeBytes, 0) };
  }

  async pathFor(id: string, ownerUserId: string, workspaceId: string) {
    const record = await this.loadRecord(id);
    if (!record) return null;
    this.validateOwnerAndWorkspace(record, ownerUserId, workspaceId);
    const absolutePath = path.resolve(this.root, record.relativePath);
    const exists = await fs.stat(absolutePath).then((value) => value.isFile()).catch(() => false);
    return exists ? absolutePath : null;
  }

  async markUsed(id: string, ownerUserId: string, workspaceId: string) {
    const record = await this.loadRecord(id);
    if (!record) throw new LocalContextLibraryError('Local file not found.');
    this.validateOwnerAndWorkspace(record, ownerUserId, workspaceId);
    const updated = { ...record, lastUsedAt: now(), updatedAt: now() };
    this.records.set(id, updated);
    await this.writeManifest(updated);
    return updated;
  }

  async link(id: string, ownerUserId: string, workspaceId: string, targetType: LocalContextTargetType, targetId: string) {
    if (!targetId.trim()) throw new LocalContextLibraryError('A linked Ledger item is required.');
    const record = await this.loadRecord(id);
    if (!record) throw new LocalContextLibraryError('Local file not found.');
    this.validateOwnerAndWorkspace(record, ownerUserId, workspaceId);
    const existing = record.links.find((link) => link.targetType === targetType && link.targetId === targetId);
    const link: LocalContextLink = existing ?? { targetType, targetId, createdAt: now() };
    const updated = existing ? record : { ...record, links: [...record.links, link], updatedAt: now() };
    this.records.set(id, updated);
    await this.writeManifest(updated);
    return updated;
  }

  async unlink(id: string, ownerUserId: string, workspaceId: string, targetType: LocalContextTargetType, targetId: string) {
    const record = await this.loadRecord(id);
    if (!record) throw new LocalContextLibraryError('Local file not found.');
    this.validateOwnerAndWorkspace(record, ownerUserId, workspaceId);
    const updated = { ...record, links: record.links.filter((link) => link.targetType !== targetType || link.targetId !== targetId), updatedAt: now() };
    this.records.set(id, updated);
    await this.writeManifest(updated);
    return updated;
  }

  async remove(id: string, ownerUserId: string, workspaceId: string) {
    const record = await this.loadRecord(id);
    if (!record) return false;
    this.validateOwnerAndWorkspace(record, ownerUserId, workspaceId);
    const absolutePath = path.resolve(this.root, record.relativePath);
    if (!isWithinRoot(this.root, absolutePath)) throw new LocalContextLibraryError('Invalid local file path.');
    await fs.rm(absolutePath, { force: true });
    await fs.rm(path.join(this.root, manifestName(id)), { force: true });
    this.records.delete(id);
    return true;
  }

  async clearAccount(ownerUserId: string) {
    const names = await fs.readdir(this.root).catch(() => [] as string[]);
    const records = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => this.loadRecord(name.slice(0, -5))));
    const ownedRecords = records.filter((record): record is LocalContextFile => {
      if (!record) return false;
      return record.ownerUserId === ownerUserId;
    });
    await Promise.all(ownedRecords.map((record) => this.remove(record.id, ownerUserId, record.workspaceId)));
  }
}

export const localContextFileStatus = (record: LocalContextFile, root: string): LocalContextFileStatus => record.status || (isWithinRoot(path.resolve(root), path.resolve(root, record.relativePath)) ? 'ready' : 'failed');
