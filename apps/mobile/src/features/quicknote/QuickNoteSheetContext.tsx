import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { QuickNoteSheet } from './QuickNoteSheet';

export type QuickNoteSheetDraft = {
  sourceLabel?: string | null;
  workspaceId?: string | null;
  onSaved?: () => void;
};

type QuickNoteSheetContextValue = {
  openQuickNoteSheet: (draft: QuickNoteSheetDraft) => void;
  closeQuickNoteSheet: () => void;
  activeDraft: QuickNoteSheetDraft | null;
};

const QuickNoteSheetContext = createContext<QuickNoteSheetContextValue | null>(null);

type QuickNoteSheetProviderProps = {
  children: ReactNode;
};

export function QuickNoteSheetProvider({ children }: QuickNoteSheetProviderProps) {
  const [activeDraft, setActiveDraft] = useState<QuickNoteSheetDraft | null>(null);

  const openQuickNoteSheet = useCallback((draft: QuickNoteSheetDraft) => {
    setActiveDraft(draft);
  }, []);

  const closeQuickNoteSheet = useCallback(() => {
    setActiveDraft(null);
  }, []);

  const value = useMemo(
    () => ({
      openQuickNoteSheet,
      closeQuickNoteSheet,
      activeDraft,
    }),
    [activeDraft, closeQuickNoteSheet, openQuickNoteSheet],
  );

  return (
    <QuickNoteSheetContext.Provider value={value}>
      {children}
      <QuickNoteSheet visible={Boolean(activeDraft)} draft={activeDraft} onClose={closeQuickNoteSheet} />
    </QuickNoteSheetContext.Provider>
  );
}

export function useQuickNoteSheet() {
  const value = useContext(QuickNoteSheetContext);

  if (!value) {
    throw new Error('useQuickNoteSheet must be used within a QuickNoteSheetProvider');
  }

  return value;
}
