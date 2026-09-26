import fs from 'node:fs';
import path from 'node:path';

export const MAC_WIDGET_APP_GROUP = 'group.com.ledger.desktop.shared';

export type MacWidgetSnapshot = {
  workspaceId: string | null;
  workspaceName: string | null;
  focusTitle: string | null;
  nextTitle: string | null;
  nextMeta: string | null;
  todayCount: number;
  upcomingCount: number;
  hasData: boolean;
  updatedAt: string;
};

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizedSnapshot(value: unknown): MacWidgetSnapshot {
  const payload = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const workspaceId = boundedString(payload.workspaceId, 200);
  const workspaceName = boundedString(payload.workspaceName, 160);
  const focusTitle = boundedString(payload.focusTitle, 240);
  const nextTitle = boundedString(payload.nextTitle, 240);
  const nextMeta = boundedString(payload.nextMeta, 120);
  const todayCount = Number.isFinite(payload.todayCount) ? Math.max(0, Number(payload.todayCount)) : 0;
  const upcomingCount = Number.isFinite(payload.upcomingCount)
    ? Math.max(0, Number(payload.upcomingCount))
    : 0;

  return {
    workspaceId,
    workspaceName,
    focusTitle,
    nextTitle,
    nextMeta,
    todayCount,
    upcomingCount,
    hasData: Boolean(workspaceId && payload.hasData),
    updatedAt: new Date().toISOString(),
  };
}

export async function writeMacWidgetSnapshot(
  homePath: string,
  value: unknown
): Promise<{ ok: true; path: string; snapshot: MacWidgetSnapshot } | { ok: false; error: string }> {
  const snapshot = normalizedSnapshot(value);
  const directory = path.join(homePath, 'Library', 'Group Containers', MAC_WIDGET_APP_GROUP, 'ledger-widget');
  const target = path.join(directory, 'today.json');
  const temporary = `${target}.tmp`;

  try {
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(temporary, JSON.stringify(snapshot), 'utf8');
    await fs.promises.rename(temporary, target);
    return { ok: true, path: target, snapshot };
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The macOS widget snapshot could not be written.',
    };
  }
}
