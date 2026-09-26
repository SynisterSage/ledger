import { useCallback, useEffect, useState } from 'react';

export type WorkspacePanePreferences = {
  left: boolean;
  right: boolean;
};

const DEFAULT_WORKSPACE_PANE_PREFERENCES: WorkspacePanePreferences = {
  left: true,
  right: true,
};

const STORAGE_KEY_PREFIX = 'ledger:workspace-pane-preferences:v1:';
const CHANGE_EVENT = 'ledger:workspace-pane-preferences-changed';

const storageKey = (workspaceId?: string | null) =>
  workspaceId ? `${STORAGE_KEY_PREFIX}${workspaceId}` : null;

const readPreferences = (workspaceId?: string | null): WorkspacePanePreferences => {
  const key = storageKey(workspaceId);
  if (!key) return DEFAULT_WORKSPACE_PANE_PREFERENCES;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Partial<WorkspacePanePreferences> | null;
    return {
      left: parsed?.left !== false,
      right: parsed?.right === true,
    };
  } catch {
    return DEFAULT_WORKSPACE_PANE_PREFERENCES;
  }
};

export const useWorkspacePanePreferences = (workspaceId?: string | null) => {
  const [preferences, setPreferences] = useState<WorkspacePanePreferences>(() =>
    readPreferences(workspaceId)
  );

  useEffect(() => {
    setPreferences(readPreferences(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    const key = storageKey(workspaceId);
    if (!key) return;

    const applyChange = (next: WorkspacePanePreferences) => setPreferences(next);
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      applyChange(readPreferences(workspaceId));
    };
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<{
        workspaceId?: string;
        preferences?: WorkspacePanePreferences;
      }>).detail;
      if (next?.workspaceId !== workspaceId || !next.preferences) return;
      applyChange(next.preferences);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(CHANGE_EVENT, handleChange);
    };
  }, [workspaceId]);

  const updatePreferences = useCallback(
    (next: Partial<WorkspacePanePreferences>) => {
      if (!workspaceId) return;
      const nextPreferences = {
        ...readPreferences(workspaceId),
        ...next,
      };
      setPreferences(nextPreferences);
      const key = storageKey(workspaceId);
      if (!key) return;
      try {
        window.localStorage.setItem(key, JSON.stringify(nextPreferences));
      } catch {
        // Keep the preference usable in the current window when storage is unavailable.
      }
      window.dispatchEvent(
        new CustomEvent(CHANGE_EVENT, {
          detail: { workspaceId, preferences: nextPreferences },
        })
      );
    },
    [workspaceId]
  );

  return { preferences, updatePreferences };
};
