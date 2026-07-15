import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  CalendarDays,
  Check,
  FileText,
  Maximize2,
  Minimize2,
  Search,
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useSearch } from '../../context/SearchContext';
import { useApi } from '../../hooks/useApi';
import { ModalCloseButton } from '../Common/ModalCloseButton';

type SearchResultType = 'note' | 'project' | 'task' | 'event';

type SearchResult = {
  type: SearchResultType;
  id: string;
  title: string;
  preview: string;
  icon: string;
  project_id?: string | null;
  focusDate?: string | null;
};

const iconMap: Record<SearchResultType, typeof FileText> = {
  note: FileText,
  project: Briefcase,
  task: Check,
  event: CalendarDays,
};

const truncatePreview = (value: string, length = 80) => {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1).trimEnd()}…`;
};

export const SearchModal = () => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const { isSearchOpen, initialQuery, closeSearch } = useSearch();
  const api = useApi();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchIdRef = useRef(0);
  const resultsRef = useRef<SearchResult[]>([]);
  const selectedIndexRef = useRef(0);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Keep refs in sync with state
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    setQuery(initialQuery);
    setResults([]);
    setSelectedIndex(0);
    setIsFullscreen(false);

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 20);

    return () => window.clearTimeout(timer);
  }, [initialQuery, isSearchOpen]);

  const activeResult = useMemo(() => results[selectedIndex] ?? null, [results, selectedIndex]);

  useEffect(() => {
    if (!isSearchOpen || !user || !activeWorkspaceId) {
      return;
    }

    if (trimmedQuery.length < 2) {
      setResults([]);
      setIsLoading(false);
      setSelectedIndex(0);
      return;
    }

    setIsLoading(true);
    const searchId = searchIdRef.current + 1;
    searchIdRef.current = searchId;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void api
        .searchWorkspace(activeWorkspaceId, trimmedQuery)
        .then((data) => {
          if (cancelled || searchIdRef.current !== searchId) return;
          const next = Array.isArray(data) ? (data as SearchResult[]) : [];
          setResults(next);
          setSelectedIndex(next.length > 0 ? 0 : 0);
        })
        .catch((error) => {
          if (cancelled || searchIdRef.current !== searchId) return;
          console.error('Search failed:', error);
          setResults([]);
        })
        .finally(() => {
          if (cancelled || searchIdRef.current !== searchId) return;
          setIsLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeWorkspaceId, api, isSearchOpen, trimmedQuery, user]);

  useEffect(() => {
    const selected = itemRefs.current[selectedIndex];
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, results]);

  useEffect(() => {
    if (!isSearchOpen) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
  }, [isSearchOpen]);

  const jumpToResult = useCallback(
    (result: SearchResult) => {
      if (result.type === 'note') {
        void window.desktopWindow?.toggleModule('notes', { focusNoteId: result.id });
      } else if (result.type === 'project') {
        void window.desktopWindow?.toggleModule('projects', { focusProjectId: result.id });
      } else if (result.type === 'task') {
        void window.desktopWindow?.toggleModule('projects', {
          focusProjectId: result.project_id ?? undefined,
          focusTaskId: result.id,
        });
      } else if (result.type === 'event') {
        const focusDate = result.focusDate ?? undefined;
        void window.desktopWindow?.openModule('calendar', focusDate ? { focusDate } : undefined);
      }

      closeSearch();
    },
    [closeSearch]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSearch();
        return;
      }

      if (event.key === 'ArrowDown') {
        if (resultsRef.current.length === 0) return;
        event.preventDefault();
        setSelectedIndex((current) => Math.min(current + 1, resultsRef.current.length - 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        if (resultsRef.current.length === 0) return;
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === 'Enter') {
        const activeResult = resultsRef.current[selectedIndexRef.current];
        if (!activeResult) return;
        event.preventDefault();
        jumpToResult(activeResult);
      }
    },
    [closeSearch, jumpToResult]
  );

  useEffect(() => {
    if (!isSearchOpen) return;

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSearchOpen, onKeyDown]);

  if (!isSearchOpen || typeof document === 'undefined' || !user || !activeWorkspaceId) {
    return null;
  }

  const shellClassName = isFullscreen
    ? 'fixed inset-0 z-[220] bg-transparent p-4 sm:p-8'
    : 'fixed inset-0 z-[220] flex items-start justify-center bg-transparent px-4 pt-16';

  const panelClassName = isFullscreen
    ? 'flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-[0_24px_70px_rgba(17,24,39,0.12)]'
    : 'flex h-[400px] w-full max-w-[500px] flex-col overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-[0_24px_70px_rgba(17,24,39,0.12)]';

  return createPortal(
    <div className={shellClassName} onMouseDown={closeSearch}>
      <div className={panelClassName} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2">
            <Search size={16} className="shrink-0 text-[var(--ledger-text-muted)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeSearch();
                }
              }}
              placeholder="Search everything..."
              className="w-full bg-transparent text-sm text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFullscreen((current) => !current)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <ModalCloseButton onClick={closeSearch} ariaLabel="Close search" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          {!trimmedQuery ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ledger-text-muted)]">
              Start typing to search...
            </div>
          ) : trimmedQuery.length < 2 ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ledger-text-muted)]">
              Type at least 2 characters to search.
            </div>
          ) : isLoading ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ledger-text-muted)]">
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ledger-text-muted)]">
              No results for “{trimmedQuery}”
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((result, index) => {
                const Icon = iconMap[result.type];
                const selected = index === selectedIndex;

                return (
                  <button
                    key={`${result.type}-${result.id}`}
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => jumpToResult(result)}
                    className={`flex w-full items-start gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
                      selected
                        ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)]'
                        : 'border-transparent hover:border-[color:var(--ledger-border-subtle)] hover:bg-[var(--ledger-surface-hover)]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                        selected
                          ? 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-accent)]'
                          : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]'
                      }`}
                    >
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--ledger-text-primary)]">
                        {result.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--ledger-text-secondary)]">
                        {truncatePreview(result.preview) || 'No preview available'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[color:var(--ledger-border-subtle)] px-4 py-3 text-[11px] text-[var(--ledger-text-muted)]">
          <span className="min-w-0 flex-1 truncate">
            ↑↓ to navigate • Enter to jump • ESC to close
          </span>
          <span className="hidden max-w-[42%] shrink-0 truncate text-right min-[460px]:inline">
            {activeResult ? `${activeResult.type} selected` : ' '}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
};
