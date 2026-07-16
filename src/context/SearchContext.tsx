import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type SearchContextValue = {
  isSearchOpen: boolean;
  initialQuery: string;
  openSearch: (query?: string) => void;
  closeSearch: () => void;
};

const SearchContext = createContext<SearchContextValue | undefined>(undefined);

export const SearchProvider = ({ children }: { children: ReactNode }) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState('');

  const openSearch = useCallback((query = '') => {
    const forwardToWorkspaceWindow = window.desktopWindow?.openSearchInWorkspaceWindow;
    if (forwardToWorkspaceWindow) {
      void forwardToWorkspaceWindow(query)
        .then((wasForwarded) => {
          if (wasForwarded) return;
          setInitialQuery(query);
          setIsSearchOpen(true);
        })
        .catch(() => {
          setInitialQuery(query);
          setIsSearchOpen(true);
        });
      return;
    }

    setInitialQuery(query);
    setIsSearchOpen(true);
  }, []);

  useEffect(() => {
    const handleSearchOpen = (
      _event: unknown,
      payload?: { query?: string | null } | null
    ) => {
      setInitialQuery(String(payload?.query ?? ''));
      setIsSearchOpen(true);
    };

    window.ipcRenderer?.on('search:open', handleSearchOpen as any);
    return () => {
      window.ipcRenderer?.off('search:open', handleSearchOpen as any);
    };
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const value = useMemo(
    () => ({ isSearchOpen, initialQuery, openSearch, closeSearch }),
    [closeSearch, initialQuery, isSearchOpen, openSearch]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
};

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within SearchProvider');
  }

  return context;
};
