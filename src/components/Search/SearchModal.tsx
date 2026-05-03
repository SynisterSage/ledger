import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Briefcase, CalendarDays, Check, FileText, Maximize2, Minimize2, Search, X } from 'lucide-react'
import { useAuthContext } from '../../context/AuthContext'
import { useWorkspaceContext } from '../../context/WorkspaceContext'
import { useSearch } from '../../context/SearchContext'
import { useApi } from '../../hooks/useApi'

type SearchResultType = 'note' | 'project' | 'task' | 'event'

type SearchResult = {
  type: SearchResultType
  id: string
  title: string
  preview: string
  icon: string
  project_id?: string | null
  focusDate?: string | null
}

const iconMap: Record<SearchResultType, typeof FileText> = {
  note: FileText,
  project: Briefcase,
  task: Check,
  event: CalendarDays,
}

const truncatePreview = (value: string, length = 80) => {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return ''
  if (text.length <= length) return text
  return `${text.slice(0, length - 1).trimEnd()}…`
}

export const SearchModal = () => {
  const { user } = useAuthContext()
  const { activeWorkspaceId } = useWorkspaceContext()
  const { isSearchOpen, closeSearch } = useSearch()
  const api = useApi()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const searchIdRef = useRef(0)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const trimmedQuery = query.trim()

  useEffect(() => {
    if (!isSearchOpen) {
      return
    }

    setQuery('')
    setResults([])
    setSelectedIndex(0)
    setIsFullscreen(false)

    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 20)

    return () => window.clearTimeout(timer)
  }, [isSearchOpen])

  const activeResult = useMemo(() => results[selectedIndex] ?? null, [results, selectedIndex])

  useEffect(() => {
    if (!isSearchOpen || !user || !activeWorkspaceId) {
      return
    }

    if (trimmedQuery.length < 2) {
      setResults([])
      setIsLoading(false)
      setSelectedIndex(0)
      return
    }

    setIsLoading(true)
    const searchId = searchIdRef.current + 1
    searchIdRef.current = searchId
    let cancelled = false

    const timer = window.setTimeout(() => {
      void api.searchWorkspace(activeWorkspaceId, trimmedQuery)
        .then((data) => {
          if (cancelled || searchIdRef.current !== searchId) return
          const next = Array.isArray(data) ? (data as SearchResult[]) : []
          setResults(next)
          setSelectedIndex(next.length > 0 ? 0 : 0)
        })
        .catch((error) => {
          if (cancelled || searchIdRef.current !== searchId) return
          console.error('Search failed:', error)
          setResults([])
        })
        .finally(() => {
          if (cancelled || searchIdRef.current !== searchId) return
          setIsLoading(false)
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeWorkspaceId, api, isSearchOpen, trimmedQuery, user])

  useEffect(() => {
    const selected = itemRefs.current[selectedIndex]
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, results])

  useEffect(() => {
    if (!isSearchOpen) return

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previous
    }
  }, [isSearchOpen])

  useEffect(() => {
    if (!isSearchOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSearch()
        return
      }

      if (event.key === 'ArrowDown') {
        if (results.length === 0) return
        event.preventDefault()
        setSelectedIndex((current) => Math.min(current + 1, results.length - 1))
        return
      }

      if (event.key === 'ArrowUp') {
        if (results.length === 0) return
        event.preventDefault()
        setSelectedIndex((current) => Math.max(current - 1, 0))
        return
      }

      if (event.key === 'Enter') {
        if (!activeResult) return
        event.preventDefault()
        jumpToResult(activeResult)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeResult, closeSearch, isSearchOpen, results.length])

  const jumpToResult = (result: SearchResult) => {
    if (result.type === 'note') {
      void window.desktopWindow?.toggleModule('notes', { focusNoteId: result.id })
    } else if (result.type === 'project') {
      void window.desktopWindow?.toggleModule('projects', { focusProjectId: result.id })
    } else if (result.type === 'task') {
      void window.desktopWindow?.toggleModule('projects', { focusProjectId: result.project_id ?? undefined, focusTaskId: result.id })
    } else if (result.type === 'event') {
      const focusDate = result.focusDate ?? undefined
      void window.desktopWindow?.toggleModule('calendar', focusDate ? { focusDate } : undefined)
    }

    closeSearch()
  }

  if (!isSearchOpen || typeof document === 'undefined' || !user || !activeWorkspaceId) {
    return null
  }

  const shellClassName = isFullscreen
    ? 'fixed inset-0 z-[220] bg-black/20 p-4 sm:p-8'
    : 'fixed inset-0 z-[220] flex items-start justify-center bg-black/20 px-4 pt-16'

  const panelClassName = isFullscreen
    ? 'flex h-full w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl'
    : 'flex h-[400px] w-full max-w-[500px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl'

  return createPortal(
    <div className={shellClassName} onMouseDown={closeSearch}>
      <div className={panelClassName} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  if (results.length > 0) setSelectedIndex((current) => Math.min(current + 1, results.length - 1))
                  return
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  if (results.length > 0) setSelectedIndex((current) => Math.max(current - 1, 0))
                  return
                }

                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (activeResult) jumpToResult(activeResult)
                  return
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeSearch()
                }
              }}
              placeholder="Search everything..."
              className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFullscreen((current) => !current)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              type="button"
              onClick={closeSearch}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {!trimmedQuery ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-gray-500">Start typing to search...</div>
          ) : trimmedQuery.length < 2 ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-gray-500">Type at least 2 characters to search.</div>
          ) : isLoading ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-gray-500">Searching…</div>
          ) : results.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-gray-500">
              No results for “{trimmedQuery}”
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((result, index) => {
                const Icon = iconMap[result.type]
                const selected = index === selectedIndex

                return (
                  <button
                    key={`${result.type}-${result.id}`}
                    ref={(element) => { itemRefs.current[index] = element }}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => jumpToResult(result)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
                      selected
                        ? 'border-[#FF5F40] bg-[#FFF0EB]'
                        : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-white text-[#FF5F40]' : 'bg-gray-100 text-gray-600'}`}>
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{result.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-gray-500">{result.preview || 'No preview available'}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-[11px] text-gray-500">
          <span>↑↓ to navigate • Enter to jump • ESC to close</span>
          <span className="truncate">{activeResult ? `${activeResult.type} selected` : ' '}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}