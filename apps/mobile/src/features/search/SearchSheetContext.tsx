import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MobileSearchResult } from '@/types/ledger';

type SearchSheetContextValue = {
  isSearchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  activeSearchResult: MobileSearchResult | null;
  openSearchResult: (result: MobileSearchResult) => void;
  closeSearchResult: () => void;
};

const SearchSheetContext = createContext<SearchSheetContextValue | null>(null);

type SearchSheetProviderProps = {
  children: ReactNode;
};

export function SearchSheetProvider({ children }: SearchSheetProviderProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeSearchResult, setActiveSearchResult] = useState<MobileSearchResult | null>(null);

  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);
  const openSearchResult = useCallback((result: MobileSearchResult) => setActiveSearchResult(result), []);
  const closeSearchResult = useCallback(() => setActiveSearchResult(null), []);

  const value = useMemo(
    () => ({
      isSearchOpen,
      openSearch,
      closeSearch,
      activeSearchResult,
      openSearchResult,
      closeSearchResult,
    }),
    [activeSearchResult, closeSearch, closeSearchResult, isSearchOpen, openSearch, openSearchResult],
  );

  return <SearchSheetContext.Provider value={value}>{children}</SearchSheetContext.Provider>;
}

export function useSearchSheet() {
  const value = useContext(SearchSheetContext);

  if (!value) {
    throw new Error('useSearchSheet must be used within a SearchSheetProvider');
  }

  return value;
}
