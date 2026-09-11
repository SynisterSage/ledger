export type WorkspaceTabRouteLike = {
  kind?: string | null;
  focusContext?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
};

/** Stable logical tab identity. View state stays inside the tab. */
export const workspaceTabRouteKey = (route: WorkspaceTabRouteLike | null | undefined) => {
  if (!route?.kind) return '';
  if (route.kind === 'new-tab') return `new-tab|${route.focusContext ?? 'default'}`;
  if (route.kind === 'notes') {
    return route.focusNoteId ? `notes|note|${route.focusNoteId}` : 'notes|home';
  }
  if (route.kind === 'projects') {
    return route.focusProjectId ? `projects|project|${route.focusProjectId}` : 'projects|home';
  }
  if (route.kind === 'circle') return 'circle';
  if (route.kind === 'teams') return 'teams';
  return route.kind;
};
