import * as SecureStore from 'expo-secure-store';

type Draft = { workspaceId: string; noteId: string; title: string; body: string; savedAt: string };
const key = (workspaceId: string, noteId: string) => `ledger-mobile-note-draft:${workspaceId}:${noteId}`;

export async function getMobileNoteDraft(workspaceId: string, noteId: string) {
  try {
    const raw = await SecureStore.getItemAsync(key(workspaceId, noteId));
    return raw ? JSON.parse(raw) as Draft : null;
  } catch { return null; }
}

export async function saveMobileNoteDraft(draft: Draft) {
  try { await SecureStore.setItemAsync(key(draft.workspaceId, draft.noteId), JSON.stringify(draft)); } catch { /* best-effort recovery cache */ }
}

export async function clearMobileNoteDraft(workspaceId: string, noteId: string) {
  try { await SecureStore.deleteItemAsync(key(workspaceId, noteId)); } catch { /* already absent */ }
}
