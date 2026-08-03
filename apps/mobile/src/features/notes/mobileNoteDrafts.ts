import * as SecureStore from 'expo-secure-store';

export type MobileNoteDraft = {
  noteId: string;
  workspaceId: string;
  title: string;
  contentHtml: string;
  body?: string;
  baseServerUpdatedAt: string | null;
  localRevision: number;
  savedLocallyAt: string;
  editorGeneration: number;
  savedAt?: string;
};
export type PendingNoteDraft = MobileNoteDraft;
const key = (workspaceId: string, noteId: string) => `ledger-mobile-note-draft:${workspaceId}:${noteId}`;

export async function getMobileNoteDraft(workspaceId: string, noteId: string) {
  try {
    const raw = await SecureStore.getItemAsync(key(workspaceId, noteId));
    return raw ? JSON.parse(raw) as PendingNoteDraft : null;
  } catch { return null; }
}

export async function saveMobileNoteDraft(draft: PendingNoteDraft) {
  try { await SecureStore.setItemAsync(key(draft.workspaceId, draft.noteId), JSON.stringify(draft)); } catch { /* best-effort recovery cache */ }
}

export async function clearMobileNoteDraft(workspaceId: string, noteId: string) {
  try { await SecureStore.deleteItemAsync(key(workspaceId, noteId)); } catch { /* already absent */ }
}
