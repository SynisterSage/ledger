import fs from 'node:fs/promises';
import path from 'node:path';
import type { LocalAskLedgerSession } from '../src/types/localAskLedgerSession.ts';

const isSafeId = (value: string) => /^[a-zA-Z0-9_-]+$/.test(value);

export class LocalAskLedgerSessionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalAskLedgerSessionStoreError';
  }
}

export class LocalAskLedgerSessionStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  private filePath(id: string) {
    if (!isSafeId(id)) throw new LocalAskLedgerSessionStoreError('Invalid local Ask Ledger session id.');
    return path.join(this.root, `${id}.json`);
  }

  private validate(session: LocalAskLedgerSession) {
    if (!session.id || !session.userId || !session.workspaceId || !session.title || !Array.isArray(session.messages)) {
      throw new LocalAskLedgerSessionStoreError('A complete local Ask Ledger session is required.');
    }
  }

  async save(session: LocalAskLedgerSession) {
    this.validate(session);
    await this.ensureRoot();
    const filePath = this.filePath(session.id);
    const temporaryPath = `${filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ ...session, privacyScope: 'device' }), { mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
    return session;
  }

  async get(id: string, userId: string, workspaceId: string) {
    await this.ensureRoot();
    try {
      const session = JSON.parse(await fs.readFile(this.filePath(id), 'utf8')) as LocalAskLedgerSession;
      if (session.userId !== userId || session.workspaceId !== workspaceId) return null;
      return session;
    } catch {
      return null;
    }
  }

  async list(userId: string, workspaceId: string, limit = 20) {
    await this.ensureRoot();
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const sessions: LocalAskLedgerSession[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const session = JSON.parse(await fs.readFile(path.join(this.root, entry.name), 'utf8')) as LocalAskLedgerSession;
        if (session.userId === userId && session.workspaceId === workspaceId && session.privacyScope === 'device') sessions.push(session);
      } catch {
        // Ignore an incomplete or corrupt local record; it must not block history.
      }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.max(1, limit));
  }

  async remove(id: string, userId: string, workspaceId: string) {
    const session = await this.get(id, userId, workspaceId);
    if (!session) return false;
    await fs.rm(this.filePath(id), { force: true });
    return true;
  }
}
