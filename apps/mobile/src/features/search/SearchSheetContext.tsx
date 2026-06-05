import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type SearchSheetContextValue = {
  isSearchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
};

const SearchSheetContext = createContext<SearchSheetContextValue | null>(null);

type SearchSheetProviderProps = {
  children: ReactNode;
};

export function SearchSheetProvider({ children }: SearchSheetProviderProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);

  const value = useMemo(
    () => ({
      isSearchOpen,
      openSearch,
      closeSearch,
    }),
    [closeSearch, isSearchOpen, openSearch],
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
