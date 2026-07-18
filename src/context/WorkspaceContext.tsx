import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuthContext } from './AuthContext';
import { DEFAULT_API_URL } from '../config/runtime';

type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type WorkspaceSummary = {
  id: string;
  name: string;
  description: string | null;
  is_personal: boolean;
  color: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  role: WorkspaceRole;
};

type WorkspaceContextType = {
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  isLoading: boolean;
  error: string | null;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

const API_URL = import.meta.env.VITE_API_URL?.trim() || DEFAULT_API_URL;
const WORKSPACE_STORAGE_KEY = 'ledger:active-workspace-id';
const WORKSPACE_NAME_STORAGE_KEY = 'ledger:active-workspace-name';

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, user } = useAuthContext();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  });
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const workspaceRefreshRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authedRequest = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      };

      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Workspace request failed');
      }

      return response.json();
    },
    [session?.access_token]
  );

  const refreshWorkspaces = useCallback(async () => {
    const requestId = ++workspaceRefreshRequestRef.current;

    if (!session?.access_token || !user) {
      setWorkspaces([]);
      activeWorkspaceIdRef.current = null;
      setActiveWorkspaceId(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const previousActiveWorkspaceId = activeWorkspaceIdRef.current;

    try {
      const [workspaceRowsResult, activeResult] = await Promise.allSettled([
        authedRequest('/api/workspaces'),
        authedRequest('/api/workspaces/active'),
      ]);

      const rows =
        workspaceRowsResult.status === 'fulfilled' && Array.isArray(workspaceRowsResult.value)
          ? (workspaceRowsResult.value as WorkspaceSummary[])
          : [];

      if (workspaceRowsResult.status === 'rejected') {
        if (requestId !== workspaceRefreshRequestRef.current) return;
        setError(
          workspaceRowsResult.reason instanceof Error
            ? workspaceRowsResult.reason.message
            : 'Could not load workspaces'
        );
        return;
      }

      const activeWorkspaceFromApi =
        activeResult.status === 'fulfilled'
          ? String((activeResult.value as { workspace_id?: string })?.workspace_id ?? '').trim() ||
            null
          : null;

      const storedWorkspaceId = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)?.trim() || null;

      const previousIsValid =
        !!previousActiveWorkspaceId &&
        rows.some((workspace) => workspace.id === previousActiveWorkspaceId);
      const storedIsValid = !!storedWorkspaceId && rows.some((workspace) => workspace.id === storedWorkspaceId);
      const apiIsValid = !!activeWorkspaceFromApi && rows.some((workspace) => workspace.id === activeWorkspaceFromApi);

      if (requestId !== workspaceRefreshRequestRef.current) return;

      const resolvedActiveWorkspaceId =
        rows.length === 0
          ? null
          : apiIsValid
          ? activeWorkspaceFromApi
          : previousIsValid
          ? previousActiveWorkspaceId
          : storedIsValid
          ? storedWorkspaceId
          : rows[0]?.id ?? null;

      setWorkspaces(rows);
      activeWorkspaceIdRef.current = resolvedActiveWorkspaceId;
      setActiveWorkspaceId(resolvedActiveWorkspaceId);

      if (resolvedActiveWorkspaceId) {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, resolvedActiveWorkspaceId);
        const resolvedActiveWorkspaceName = rows.find((workspace) => workspace.id === resolvedActiveWorkspaceId)?.name?.trim() || '';
        if (resolvedActiveWorkspaceName) {
          window.localStorage.setItem(WORKSPACE_NAME_STORAGE_KEY, resolvedActiveWorkspaceName);
        }
      } else {
        window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
        window.localStorage.removeItem(WORKSPACE_NAME_STORAGE_KEY);
      }
    } catch (fetchError) {
      if (requestId !== workspaceRefreshRequestRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load workspaces');
    } finally {
      if (requestId === workspaceRefreshRequestRef.current) {
        setIsLoading(false);
      }
    }
  }, [authedRequest, session?.access_token, user]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [session?.access_token, user]);

  useEffect(() => {
    const handleWorkspacesChanged = () => {
      void refreshWorkspaces();
    };

    window.addEventListener('ledger:workspaces-changed', handleWorkspacesChanged as EventListener);
    return () =>
      window.removeEventListener(
        'ledger:workspaces-changed',
        handleWorkspacesChanged as EventListener
      );
  }, [refreshWorkspaces]);

  useEffect(() => {
    const handleMembershipChanged = () => {
      void refreshWorkspaces();
    };

    window.addEventListener('ledger:membership-changed', handleMembershipChanged as EventListener);
    return () =>
      window.removeEventListener(
        'ledger:membership-changed',
        handleMembershipChanged as EventListener
      );
  }, [refreshWorkspaces]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_STORAGE_KEY) return;
      const nextWorkspaceId = event.newValue ? String(event.newValue).trim() : null;
      activeWorkspaceIdRef.current = nextWorkspaceId || null;
      setActiveWorkspaceId(nextWorkspaceId || null);
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    // Keep workspace in sync across Electron windows where StorageEvent propagation
    // can be inconsistent depending on process/webview boundaries.
    const syncFromStorage = () => {
      const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
      const normalized = stored ? String(stored).trim() : null;
      const next = normalized || null;
      if (next !== activeWorkspaceIdRef.current) {
        activeWorkspaceIdRef.current = next;
        setActiveWorkspaceId(next);
      }
    };

    const timer = window.setInterval(syncFromStorage, 500);
    return () => window.clearInterval(timer);
  }, [activeWorkspaceId]);

  const setActiveWorkspace = useCallback(
    async (workspaceId: string) => {
      const nextWorkspaceId = String(workspaceId ?? '').trim();
      if (!nextWorkspaceId || nextWorkspaceId === activeWorkspaceIdRef.current) return;

      const previousWorkspaceId = activeWorkspaceIdRef.current;
      const nextWorkspaceName =
        workspaces.find((workspace) => workspace.id === nextWorkspaceId)?.name?.trim() || '';

      setError(null);

      // Update the renderer immediately so workspace switching does not block on
      // the network request. The API remains authoritative and we roll back if it
      // rejects the change.
      activeWorkspaceIdRef.current = nextWorkspaceId;
      setActiveWorkspaceId(nextWorkspaceId);
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, nextWorkspaceId);
      if (nextWorkspaceName) {
        window.localStorage.setItem(WORKSPACE_NAME_STORAGE_KEY, nextWorkspaceName);
      }
      window.dispatchEvent(
        new CustomEvent('ledger:workspace-changed', { detail: { workspaceId: nextWorkspaceId } })
      );

      try {
        const payload = (await authedRequest('/api/workspaces/active', {
          method: 'PATCH',
          body: JSON.stringify({ workspace_id: nextWorkspaceId }),
        })) as { workspace_id?: string };

        const confirmedWorkspaceId = String(payload?.workspace_id ?? '').trim();
        if (!confirmedWorkspaceId || confirmedWorkspaceId !== nextWorkspaceId) {
          throw new Error('Invalid workspace response');
        }
      } catch (switchError) {
        activeWorkspaceIdRef.current = previousWorkspaceId;
        setActiveWorkspaceId(previousWorkspaceId);
        if (previousWorkspaceId) {
          window.localStorage.setItem(WORKSPACE_STORAGE_KEY, previousWorkspaceId);
          const previousWorkspaceName =
            workspaces.find((workspace) => workspace.id === previousWorkspaceId)?.name?.trim() || '';
          if (previousWorkspaceName) {
            window.localStorage.setItem(WORKSPACE_NAME_STORAGE_KEY, previousWorkspaceName);
          }
        } else {
          window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
          window.localStorage.removeItem(WORKSPACE_NAME_STORAGE_KEY);
        }
        window.dispatchEvent(
          new CustomEvent('ledger:workspace-changed', {
            detail: { workspaceId: previousWorkspaceId },
          })
        );
        setError(switchError instanceof Error ? switchError.message : 'Could not switch workspace');
        throw switchError;
      }
    },
    [authedRequest, workspaces]
  );

    useEffect(() => {
      const handler = (_event: unknown, payload?: { workspaceId?: string | null }) => {
        const next = payload?.workspaceId ?? null;
        if (!next) return;
        void (async () => {
          try {
            await setActiveWorkspace(next);
          } catch (e) {
            // ignore failures triggered from main process
          }
        })();
      };

      window.ipcRenderer?.on('ledger:set-active-workspace', handler as any);
      return () => {
        window.ipcRenderer?.off('ledger:set-active-workspace', handler as any);
      };
    }, [setActiveWorkspace]);

  const activeWorkspace = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  }, [activeWorkspaceId, workspaces]);

  const value = useMemo(
    () => ({
      activeWorkspaceId,
      activeWorkspace,
      workspaces,
      isLoading,
      error,
      setActiveWorkspace,
      refreshWorkspaces,
    }),
    [
      activeWorkspaceId,
      activeWorkspace,
      workspaces,
      isLoading,
      error,
      setActiveWorkspace,
      refreshWorkspaces,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspaceContext = () => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspaceContext must be used within WorkspaceProvider');
  }
  return context;
};

export default WorkspaceContext;
