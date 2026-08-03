type NoteRouteParams = {
  id: string;
  workspaceId?: string;
  returnTo?: string;
  mode?: 'write' | 'transcript' | 'map';
  focusSegmentId?: string;
  focusNodeId?: string;
  focus?: 'title' | 'editor';
};

type MobileRouter = {
  push: (...args: any[]) => void;
};

export type OpenMobileNoteOptions = Omit<NoteRouteParams, 'id'>;

/** The sole in-app destination for opening an existing Ledger note. */
export function openMobileNote(router: MobileRouter, noteId: string | null | undefined, options: OpenMobileNoteOptions = {}) {
  const id = noteId?.trim();
  if (!id) return false;

  const params = Object.entries({ id, ...options }).reduce<Record<string, string>>((result, [key, value]) => {
    if (typeof value === 'string' && value.length > 0) result[key] = value;
    return result;
  }, {});

  router.push({ pathname: '/note/[id]', params: params as { id: string } & Record<string, string> });
  return true;
}
