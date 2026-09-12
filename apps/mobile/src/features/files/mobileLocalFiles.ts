import * as FileSystem from 'expo-file-system/legacy';

export type MobileLocalFile = {
  id: string;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  uri: string;
  createdAt: string;
};

const safePathPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
const root = (userId: string, workspaceId: string) =>
  `${
    FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''
  }ledger-local-files/${safePathPart(userId)}/${safePathPart(workspaceId)}/`;
const manifestPath = (userId: string, workspaceId: string) =>
  `${root(userId, workspaceId)}manifest.json`;

async function readManifest(userId: string, workspaceId: string): Promise<MobileLocalFile[]> {
  try {
    const value = JSON.parse(await FileSystem.readAsStringAsync(manifestPath(userId, workspaceId)));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function writeManifest(files: MobileLocalFile[], userId: string, workspaceId: string) {
  await FileSystem.makeDirectoryAsync(root(userId, workspaceId), { intermediates: true });
  await FileSystem.writeAsStringAsync(manifestPath(userId, workspaceId), JSON.stringify(files));
}

export async function listMobileLocalFiles(userId: string, workspaceId: string) {
  const files = await readManifest(userId, workspaceId);
  const accessible = (
    await Promise.all(
      files.map(async (file) => {
        const info = await FileSystem.getInfoAsync(file.uri);
        return info.exists ? file : null;
      })
    )
  ).filter((file): file is MobileLocalFile => Boolean(file));
  if (accessible.length !== files.length) await writeManifest(accessible, userId, workspaceId);
  return accessible;
}

export async function importMobileLocalFile(
  asset: { uri: string; name: string; mimeType?: string | null; size?: number | null },
  userId: string,
  workspaceId: string
) {
  const id = `mobile-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeName = asset.name.replace(/[^a-z0-9._-]/gi, '-').slice(0, 160) || 'file';
  const uri = `${root(userId, workspaceId)}${id}-${safeName}`;
  await FileSystem.makeDirectoryAsync(root(userId, workspaceId), { intermediates: true });
  await FileSystem.copyAsync({ from: asset.uri, to: uri });
  const file: MobileLocalFile = {
    id,
    name: asset.name,
    mimeType: asset.mimeType,
    sizeBytes: asset.size,
    uri,
    createdAt: new Date().toISOString(),
  };
  await writeManifest([file, ...(await readManifest(userId, workspaceId))], userId, workspaceId);
  return file;
}

export async function removeMobileLocalFile(id: string, userId: string, workspaceId: string) {
  const files = await readManifest(userId, workspaceId);
  const file = files.find((item) => item.id === id);
  if (!file) return false;
  try {
    await FileSystem.deleteAsync(file.uri, { idempotent: true });
  } catch {
    // The manifest is still authoritative for Ledger. A stale/inaccessible
    // managed copy should not block removing the item from the workspace view.
  }
  await writeManifest(
    files.filter((item) => item.id !== id),
    userId,
    workspaceId
  );
  return true;
}

export async function saveMobileLocalText(
  id: string,
  text: string,
  userId: string,
  workspaceId: string
) {
  const files = await readManifest(userId, workspaceId);
  const file = files.find((item) => item.id === id);
  if (!file || !(file.mimeType?.startsWith('text/') || /\.(txt|md|csv)$/i.test(file.name)))
    throw new Error('Only text files can be edited on mobile.');
  await FileSystem.writeAsStringAsync(file.uri, text);
  const updated = { ...file, sizeBytes: text.length };
  await writeManifest(
    files.map((item) => (item.id === id ? updated : item)),
    userId,
    workspaceId
  );
  return updated;
}
