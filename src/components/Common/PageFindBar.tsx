import { ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

type FindMatch = {
  mark: HTMLElement;
  index: number;
};

type FindTextNode = {
  node: Text;
  start: number;
  end: number;
};

const isHiddenFromFind = (node: Node) => {
  const element = node.parentElement;
  if (!element) return true;
  if (element.closest('[data-page-find-bar], script, style, noscript')) return true;
  if (element.closest('input, textarea, select')) return true;

  // Keep-alive modules are hidden with display:none. Use the rendered layout
  // instead of aria-hidden because active pages can contain aria-hidden icons
  // and decorative wrappers around their visible labels.
  let currentElement: HTMLElement | null = element;
  while (currentElement && currentElement !== document.body) {
    const computedStyle = window.getComputedStyle(currentElement);
    if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') return true;
    currentElement = currentElement.parentElement;
  }

  return false;
};

const clearFindHighlights = () => {
  document.querySelectorAll<HTMLElement>('[data-page-find-match]').forEach((mark) => {
    mark.replaceWith(...Array.from(mark.childNodes));
  });
};

const highlightMatches = (query: string): FindMatch[] => {
  clearFindHighlights();
  if (!query.trim()) return [];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes: FindTextNode[] = [];
  let searchableText = '';
  let currentNode: Node | null = walker.nextNode();

  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE && !isHiddenFromFind(currentNode)) {
      const node = currentNode as Text;
      const text = node.nodeValue ?? '';
      const start = searchableText.length;
      searchableText += text;
      textNodes.push({ node, start, end: searchableText.length });
    }
    currentNode = walker.nextNode();
  }

  const normalizedQuery = query.toLocaleLowerCase();
  const normalizedText = searchableText.toLocaleLowerCase();
  const ranges: Array<[number, number]> = [];
  let fromIndex = 0;
  while (fromIndex < normalizedText.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, fromIndex);
    if (matchIndex === -1) break;
    ranges.push([matchIndex, matchIndex + normalizedQuery.length]);
    fromIndex = matchIndex + Math.max(normalizedQuery.length, 1);
  }

  const locate = (offset: number, endOffset = false) => {
    const segment = textNodes.find(({ start, end }) =>
      endOffset ? offset > start && offset <= end : offset >= start && offset < end
    );
    if (!segment) return null;
    return {
      node: segment.node,
      offset: offset - segment.start,
    };
  };

  const matches: FindMatch[] = [];
  // Work backwards so splitting a text node does not invalidate earlier ranges.
  [...ranges].reverse().forEach(([start, end]) => {
    const rangeStart = locate(start);
    const rangeEnd = locate(end, true);
    if (!rangeStart || !rangeEnd) return;

    const range = document.createRange();
    range.setStart(rangeStart.node, rangeStart.offset);
    range.setEnd(rangeEnd.node, rangeEnd.offset);
    const mark = document.createElement('mark');
    mark.dataset.pageFindMatch = 'true';
    mark.style.backgroundColor = 'color-mix(in srgb, var(--ledger-accent) 24%, transparent)';
    mark.style.borderRadius = '3px';
    mark.style.color = 'inherit';
    mark.append(range.extractContents());
    range.insertNode(mark);
    matches.unshift({ mark, index: 0 });
  });

  return matches.map((match, index) => ({ ...match, index }));
};

export const usePageFind = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    clearFindHighlights();
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const move = useCallback(
    (direction: 1 | -1) => {
      if (!matches.length) return;
      setCurrentIndex((index) => (index + direction + matches.length) % matches.length);
    },
    [matches.length]
  );

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      open();
    };
    window.addEventListener('keydown', handleShortcut, true);
    return () => window.removeEventListener('keydown', handleShortcut, true);
  }, [open]);

  useEffect(() => {
    if (!isOpen) return;
    const nextMatches = highlightMatches(query);
    setMatches(nextMatches);
    setCurrentIndex((index) => (nextMatches.length ? Math.min(index, nextMatches.length - 1) : 0));
    return clearFindHighlights;
  }, [isOpen, query]);

  useEffect(() => {
    const currentMatch = matches[currentIndex];
    if (!currentMatch?.mark.isConnected) return;
    matches.forEach(({ mark }) => {
      mark.removeAttribute('data-page-find-current');
      mark.style.backgroundColor = 'color-mix(in srgb, var(--ledger-accent) 24%, transparent)';
    });
    currentMatch.mark.dataset.pageFindCurrent = 'true';
    currentMatch.mark.style.backgroundColor = 'var(--ledger-accent)';
    currentMatch.mark.style.color = '#ffffff';
    currentMatch.mark.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [currentIndex, matches]);

  useEffect(() => () => clearFindHighlights(), []);

  return {
    close,
    currentIndex,
    inputRef,
    isOpen,
    matches,
    move,
    open,
    query,
    setQuery,
  };
};

export const PageFindBar = () => {
  const { close, currentIndex, inputRef, isOpen, matches, move, query, setQuery } = usePageFind();
  const [headerBottom, setHeaderBottom] = useState(12);

  useEffect(() => {
    if (!isOpen) return;

    const getVisibleHeader = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-ledger-module-header]')).find(
        (header) => {
          const rect = header.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
      );

    const updatePosition = () => {
      const header = getVisibleHeader();
      setHeaderBottom(header ? header.getBoundingClientRect().bottom + 8 : 12);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const observer = new ResizeObserver(updatePosition);
    document
      .querySelectorAll<HTMLElement>('[data-ledger-module-header]')
      .forEach((header) => observer.observe(header));
    const mutationObserver = new MutationObserver(updatePosition);
    mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'style', 'class'],
      childList: true,
      subtree: true,
    });

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      move(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <div
      data-page-find-bar
      className="fixed right-4 z-[90] flex h-11 w-[min(380px,calc(100vw-32px))] items-center gap-1.5 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2 shadow-[0_12px_32px_rgba(17,24,39,0.16)]"
      style={{ top: headerBottom }}
      role="search"
      aria-label="Find on page"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Find on page"
        aria-label="Find on page"
        className="min-w-0 flex-1 bg-transparent px-2 text-[13px] text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)]"
      />
      <span className="shrink-0 min-w-[42px] text-center text-[11px] text-[var(--ledger-text-muted)]">
        {matches.length ? `${currentIndex + 1} / ${matches.length}` : query ? '0 / 0' : ''}
      </span>
      <button
        type="button"
        onClick={() => move(-1)}
        disabled={!matches.length}
        aria-label="Previous result"
        title="Previous result"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ChevronUp size={16} />
      </button>
      <button
        type="button"
        onClick={() => move(1)}
        disabled={!matches.length}
        aria-label="Next result"
        title="Next result"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ChevronDown size={16} />
      </button>
      <button
        type="button"
        onClick={close}
        aria-label="Close find on page"
        title="Close"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
      >
        <X size={16} />
      </button>
    </div>
  );
};
