import type { LinkedWorkSummary } from './types';

export type NodeReferenceCache = {
  version: 1;
  workspaceId: string;
  externalReferenceId: string;
  targetIds: Array<{ type: string; id: string }>;
  syncedAt: string;
};

export const parseNodeReferenceCache = (value: unknown): NodeReferenceCache | null => {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Partial<NodeReferenceCache>;
    if (parsed.version !== 1 || typeof parsed.workspaceId !== 'string' || typeof parsed.externalReferenceId !== 'string' || !Array.isArray(parsed.targetIds)) return null;
    const targetIds = parsed.targetIds.filter((target): target is { type: string; id: string } => Boolean(target) && typeof target.type === 'string' && typeof target.id === 'string').slice(0, 100);
    return { version: 1, workspaceId: parsed.workspaceId.slice(0, 128), externalReferenceId: parsed.externalReferenceId.slice(0, 128), targetIds, syncedAt: typeof parsed.syncedAt === 'string' ? parsed.syncedAt : '' };
  } catch { return null; }
};

export const buildNodeReferenceCache = (workspaceId: string, externalReferenceId: string, rows: LinkedWorkSummary[]): NodeReferenceCache => ({ version: 1, workspaceId, externalReferenceId, targetIds: rows.slice(0, 100).map((row) => ({ type: row.type, id: row.id })), syncedAt: new Date().toISOString() });
