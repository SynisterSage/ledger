import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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

const SEARCH_TRAY_CLOSE_DELAY = 220;

type SearchSheetProviderProps = {
  children: ReactNode;
};

export function SearchSheetProvider({ children }: SearchSheetProviderProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeSearchResult, setActiveSearchResult] = useState<MobileSearchResult | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);
  const openSearchResult = useCallback((result: MobileSearchResult) => {
    if (resultTimerRef.current) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }

    setActiveSearchResult(null);
    setIsSearchOpen(false);

    resultTimerRef.current = setTimeout(() => {
      setActiveSearchResult(result);
      resultTimerRef.current = null;
    }, SEARCH_TRAY_CLOSE_DELAY);
  }, []);
  const closeSearchResult = useCallback(() => {
    if (resultTimerRef.current) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }

    setActiveSearchResult(null);
  }, []);

  useEffect(() => {
    return () => {
      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
        resultTimerRef.current = null;
      }
    };
  }, []);

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
