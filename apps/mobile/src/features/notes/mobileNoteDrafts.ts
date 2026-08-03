import * as SecureStore from 'expo-secure-store';

export type PendingNoteDraft = { noteId: string; workspaceId: string; title: string; body: string; contentHtml?: string; baseServerUpdatedAt?: string | null; savedLocallyAt?: string; editorGeneration?: number; savedAt: string };
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
