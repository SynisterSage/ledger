import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthContext } from './AuthContext';
import { useWorkspaceContext } from './WorkspaceContext';
import { useApi } from '../hooks/useApi';
import { useWorkspaceRealtimeRefresh } from '../hooks/useWorkspaceRealtimeRefresh';
import {
  isRouteMatchingPin,
  type PinFolder,
  type PinObjectType,
  type PinRecord,
  type WorkspaceRoute,
} from '../utils/pins';

type PinObjectInput = {
  objectType: PinObjectType;
  objectId: string;
  folderId?: string | null;
  sortOrder?: number;
};

type UpdatePinInput = {
  folderId?: string | null;
  sortOrder?: number;
};

type UpdatePinFolderInput = {
  name?: string;
  sortOrder?: number;
  collapsed?: boolean;
};

type PinFolderInput = {
  name: string;
  sortOrder?: number;
  collapsed?: boolean;
};

type ReorderPinInput = {
  id: string;
  folder_id?: string | null;
  sort_order?: number;
};

type PinsContextValue = {
  pins: PinRecord[];
  folders: PinFolder[];
  activeRoute: WorkspaceRoute | null;
  activePinId: string | null;
  isLoadingPins: boolean;
  refreshPins: () => Promise<void>;
  isPinned: (objectType: PinObjectType, objectId: string) => boolean;
  getPinByObject: (objectType: PinObjectType, objectId: string) => PinRecord | undefined;
  getPinById: (pinId: string) => PinRecord | undefined;
  pinObject: (input: PinObjectInput) => Promise<PinRecord | null>;
  toggleObjectPin: (input: PinObjectInput) => Promise<PinRecord | null>;
  unpinObject: (pinId: string) => Promise<void>;
  updatePin: (pinId: string, input: UpdatePinInput) => Promise<PinRecord | null>;
  reorderPins: (items: ReorderPinInput[]) => Promise<PinRecord[]>;
  getPinFolders: () => Promise<PinFolder[]>;
  createPinFolder: (input: PinFolderInput) => Promise<PinFolder | null>;
  updatePinFolder: (folderId: string, input: UpdatePinFolderInput) => Promise<PinFolder | null>;
  deletePinFolder: (folderId: string) => Promise<void>;
  reorderPinFolders: (items: Array<{ id: string; sort_order?: number }>) => Promise<PinFolder[]>;
};

const PinsContext = createContext<PinsContextValue | undefined>(undefined);

const normalizePinsPayload = (payload: unknown): PinRecord[] => {
  if (Array.isArray(payload)) return payload as PinRecord[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { pins?: unknown }).pins)) {
    return (payload as { pins: PinRecord[] }).pins;
  }
  return [];
};

const normalizeFoldersPayload = (payload: unknown): PinFolder[] => {
  if (Array.isArray(payload)) return payload as PinFolder[];
  if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as { folders?: unknown }).folders)
  ) {
    return (payload as { folders: PinFolder[] }).folders;
  }
  return [];
};

const sortPins = (items: PinRecord[]) =>
  [...items].sort((a, b) => {
    const folderA = a.folder_id ?? '';
    const folderB = b.folder_id ?? '';
    if (folderA !== folderB) {
      if (!folderA) return -1;
      if (!folderB) return 1;
      return folderA.localeCompare(folderB);
    }
    const diff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
    if (diff !== 0) return diff;
    return String(a.title ?? '').localeCompare(String(b.title ?? ''));
  });

const sortFolders = (items: PinFolder[]) =>
  [...items].sort((a, b) => {
    const diff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
    if (diff !== 0) return diff;
    return String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });

export const PinsProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const api = useApi();
  const [pins, setPins] = useState<PinRecord[]>([]);
  const [folders, setFolders] = useState<PinFolder[]>([]);
  const [activeRoute, setActiveRoute] = useState<WorkspaceRoute | null>(null);
  const [isLoadingPins, setIsLoadingPins] = useState(true);

  const refreshPins = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!user || !activeWorkspaceId) {
        setPins([]);
        setFolders([]);
        setActiveRoute(null);
        setIsLoadingPins(false);
        return;
      }

      if (!options?.silent) {
        setIsLoadingPins(true);
      }

      try {
        const [pinsPayload, foldersPayload] = await Promise.all([api.getPins(), api.getPinFolders()]);
        setPins(sortPins(normalizePinsPayload(pinsPayload)));
        setFolders(sortFolders(normalizeFoldersPayload(foldersPayload)));
      } catch (error) {
        console.error('Failed to load pins:', error);
        setPins([]);
        setFolders([]);
      } finally {
        setIsLoadingPins(false);
      }
    },
    [activeWorkspaceId, api, user]
  );

  useEffect(() => {
    void refreshPins();
  }, [refreshPins, activeWorkspaceId, user?.id]);

  useWorkspaceRealtimeRefresh({
    workspaceId: activeWorkspaceId,
    tables: [
      'user_pins',
      'pin_folders',
      'person_preferences',
      'workspace_members',
      'workspace_team_members',
      'workspace_teams',
      'projects',
      'notes',
      'tasks',
      'events',
      'reminders',
    ],
    enabled: Boolean(user && activeWorkspaceId),
    onChange: () => {
      void refreshPins({ silent: true });
    },
  });

  useEffect(() => {
    let cancelled = false;

    const loadRoute = async () => {
      try {
        const state = (await window.desktopWindow?.getWorkspaceNavigationState?.()) as
          | { currentRoute?: WorkspaceRoute | null }
          | null
          | undefined;
        if (!cancelled) {
          setActiveRoute(state?.currentRoute ?? null);
        }
      } catch {
        if (!cancelled) {
          setActiveRoute(null);
        }
      }
    };

    void loadRoute();

    const handleNavigationState = (
      _event: unknown,
      payload?: { currentRoute?: WorkspaceRoute | null }
    ) => {
      setActiveRoute(payload?.currentRoute ?? null);
    };

    window.ipcRenderer?.on('workspace:navigation-state', handleNavigationState as any);
    return () => {
      cancelled = true;
      window.ipcRenderer?.off('workspace:navigation-state', handleNavigationState as any);
    };
  }, [activeWorkspaceId, user?.id]);

  const getPinByObject = useCallback(
    (objectType: PinObjectType, objectId: string) =>
      pins.find(
        (pin) => pin.object_type === objectType && String(pin.object_id) === String(objectId)
      ),
    [pins]
  );

  const getPinById = useCallback((pinId: string) => pins.find((pin) => pin.id === pinId), [pins]);

  const isPinned = useCallback(
    (objectType: PinObjectType, objectId: string) => Boolean(getPinByObject(objectType, objectId)),
    [getPinByObject]
  );

  const getActivePinId = useMemo(
    () => pins.find((pin) => isRouteMatchingPin(activeRoute, pin))?.id ?? null,
    [activeRoute, pins]
  );

  const pinObject = useCallback(
    async (input: PinObjectInput) => {
      const response = (await api.pinObject(input.objectType, input.objectId, {
        folder_id: input.folderId ?? undefined,
        sort_order: input.sortOrder,
      })) as { pin?: PinRecord | null };
      const pin = response?.pin ?? null;
      if (pin) {
        setPins((current) => {
          const next = current.filter((item) => item.id !== pin.id);
          next.push(pin);
          return sortPins(next);
        });
      }
      void refreshPins({ silent: true });
      return pin;
    },
    [api, refreshPins]
  );

  const unpinObject = useCallback(
    async (pinId: string) => {
      await api.unpinObject(pinId);
      setPins((current) => current.filter((pin) => pin.id !== pinId));
      void refreshPins({ silent: true });
    },
    [api, refreshPins]
  );

  const toggleObjectPin = useCallback(
    async (input: PinObjectInput) => {
      const existing = getPinByObject(input.objectType, input.objectId);
      if (existing) {
        await unpinObject(existing.id);
        return null;
      }
      return pinObject(input);
    },
    [getPinByObject, pinObject, unpinObject]
  );

  const updatePin = useCallback(
    async (pinId: string, input: UpdatePinInput) => {
      const response = (await api.updatePin(pinId, {
        folder_id: input.folderId === undefined ? undefined : input.folderId,
        sort_order: input.sortOrder,
      })) as { pin?: PinRecord | null };
      const pin = response?.pin ?? null;
      if (pin) {
        setPins((current) => current.map((item) => (item.id === pin.id ? pin : item)));
      }
      void refreshPins({ silent: true });
      return pin;
    },
    [api, refreshPins]
  );

  const reorderPins = useCallback(
    async (items: ReorderPinInput[]) => {
      const response = (await api.reorderPins(items)) as { pins?: PinRecord[] };
      const nextPins = sortPins(normalizePinsPayload(response));
      if (nextPins.length > 0) {
        setPins(nextPins);
      }
      void refreshPins({ silent: true });
      return nextPins;
    },
    [api, refreshPins]
  );

  const getPinFolders = useCallback(async () => {
    const response = await api.getPinFolders();
    const nextFolders = sortFolders(normalizeFoldersPayload(response));
    setFolders(nextFolders);
    return nextFolders;
  }, [api]);

  const createPinFolder = useCallback(
    async (input: PinFolderInput) => {
      const response = (await api.createPinFolder({
        name: input.name,
        sort_order: input.sortOrder,
        collapsed: input.collapsed,
      })) as { folder?: PinFolder | null };
      const folder = response?.folder ?? null;
      if (folder) {
        setFolders((current) => sortFolders([...current.filter((item) => item.id !== folder.id), folder]));
      }
      void refreshPins({ silent: true });
      return folder;
    },
    [api, refreshPins]
  );

  const updatePinFolder = useCallback(
    async (folderId: string, input: UpdatePinFolderInput) => {
      const response = (await api.updatePinFolder(folderId, {
        name: input.name,
        sort_order: input.sortOrder,
        collapsed: input.collapsed,
      })) as { folder?: PinFolder | null };
      const folder = response?.folder ?? null;
      if (folder) {
        setFolders((current) =>
          sortFolders(current.map((item) => (item.id === folder.id ? folder : item)))
        );
      }
      void refreshPins({ silent: true });
      return folder;
    },
    [api, refreshPins]
  );

  const deletePinFolder = useCallback(
    async (folderId: string) => {
      await api.deletePinFolder(folderId);
      setFolders((current) => current.filter((item) => item.id !== folderId));
      void refreshPins({ silent: true });
    },
    [api, refreshPins]
  );

  const reorderPinFolders = useCallback(
    async (items: Array<{ id: string; sort_order?: number }>) => {
      const response = (await api.reorderPinFolders(items)) as { folders?: PinFolder[] };
      const nextFolders = sortFolders(normalizeFoldersPayload(response));
      if (nextFolders.length > 0) {
        setFolders(nextFolders);
      }
      void refreshPins({ silent: true });
      return nextFolders;
    },
    [api, refreshPins]
  );

  const value = useMemo<PinsContextValue>(
    () => ({
      pins,
      folders,
      activeRoute,
      activePinId: getActivePinId,
      isLoadingPins,
      refreshPins,
      isPinned,
      getPinByObject,
      getPinById,
      pinObject,
      toggleObjectPin,
      unpinObject,
      updatePin,
      reorderPins,
      getPinFolders,
      createPinFolder,
      updatePinFolder,
      deletePinFolder,
      reorderPinFolders,
    }),
    [
      activeRoute,
      createPinFolder,
      deletePinFolder,
      folders,
      getActivePinId,
      getPinById,
      getPinByObject,
      getPinFolders,
      isLoadingPins,
      isPinned,
      pinObject,
      pins,
      refreshPins,
      reorderPinFolders,
      reorderPins,
      toggleObjectPin,
      unpinObject,
      updatePin,
      updatePinFolder,
    ]
  );

  return <PinsContext.Provider value={value}>{children}</PinsContext.Provider>;
};

export const usePins = () => {
  const context = useContext(PinsContext);
  if (!context) {
    throw new Error('usePins must be used within a PinsProvider');
  }
  return context;
};
