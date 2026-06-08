import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { FollowUpSheet } from './FollowUpSheet';

export type FollowUpSheetDraft = {
  title: string;
  notes?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  sourceLabel?: string | null;
  sourceTitle?: string | null;
  sourceType?: 'calendar_event' | 'note' | 'task' | 'project' | 'reminder' | null;
  sourceId?: string | null;
  onSaved?: () => void;
};

type FollowUpSheetContextValue = {
  openFollowUpSheet: (draft: FollowUpSheetDraft) => void;
  closeFollowUpSheet: () => void;
  activeDraft: FollowUpSheetDraft | null;
};

const FollowUpSheetContext = createContext<FollowUpSheetContextValue | null>(null);

type FollowUpSheetProviderProps = {
  children: ReactNode;
};

export function FollowUpSheetProvider({ children }: FollowUpSheetProviderProps) {
  const [activeDraft, setActiveDraft] = useState<FollowUpSheetDraft | null>(null);

  const openFollowUpSheet = useCallback((draft: FollowUpSheetDraft) => {
    setActiveDraft(draft);
  }, []);

  const closeFollowUpSheet = useCallback(() => {
    setActiveDraft(null);
  }, []);

  const value = useMemo(
    () => ({
      openFollowUpSheet,
      closeFollowUpSheet,
      activeDraft,
    }),
    [activeDraft, closeFollowUpSheet, openFollowUpSheet],
  );

  return (
    <FollowUpSheetContext.Provider value={value}>
      {children}
      <FollowUpSheet
        visible={Boolean(activeDraft)}
        draft={activeDraft}
        onClose={closeFollowUpSheet}
      />
    </FollowUpSheetContext.Provider>
  );
}

export function useFollowUpSheet() {
  const value = useContext(FollowUpSheetContext);

  if (!value) {
    throw new Error('useFollowUpSheet must be used within a FollowUpSheetProvider');
  }

  return value;
}
