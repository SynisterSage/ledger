import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useApi } from '../../hooks/useApi';

export type GithubResourcePickerResult = {
  resourceType: 'repository' | 'issue' | 'pull_request';
  referenceId?: string;
  githubRepositoryId?: string | number | null;
  githubId?: string | number | null;
  number?: string | number | null;
  title?: string | null;
  repositoryFullName?: string | null;
  canonicalUrl?: string | null;
  state?: string | null;
  isPrivate?: boolean;
  isArchived?: boolean;
  defaultBranch?: string | null;
};

type PickerType = 'all' | GithubResourcePickerResult['resourceType'];

export function GithubResourcePicker({
  onSelect,
  existingReferenceIds = [],
  triggerLabel = 'Add GitHub resource',
  disabled = false,
}: {
  onSelect: (resource: GithubResourcePickerResult) => void | Promise<void>;
  existingReferenceIds?: string[];
  triggerLabel?: string;
  disabled?: boolean;
}) {
  const api = useApi();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<PickerType>('all');
  const [repositoryId, setRepositoryId] = useState('');
  const [repositories, setRepositories] = useState<Array<{ github_repository_id: string; full_name: string; is_private?: boolean; is_archived?: boolean }>>([]);
  const [results, setResults] = useState<GithubResourcePickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!repositories.length) void api.getGithubRepositories().then((payload) => setRepositories(Array.isArray(payload) ? payload as typeof repositories : [])).catch(() => setRepositories([]));
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void api.searchGithubResources({ query: query.trim(), type, repositoryId: repositoryId || undefined, limit: 30 })
        .then((payload) => setResults(Array.isArray(payload) ? payload as GithubResourcePickerResult[] : []))
        .catch((reason) => {
          setResults([]);
          setError(reason instanceof Error ? reason.message : 'GitHub search is unavailable.');
        })
        .finally(() => setLoading(false));
    }, query.trim() ? 240 : 80);
    return () => window.clearTimeout(timer);
  }, [api, open, query, repositoryId, repositories.length, type]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        window.setTimeout(() => triggerRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const select = async (resource: GithubResourcePickerResult) => {
    if (resource.referenceId && existingReferenceIds.includes(resource.referenceId)) return;
    if (resource.resourceType === 'repository' && resource.isArchived) return;
    const key = resource.referenceId ?? resource.canonicalUrl ?? `${resource.resourceType}:${resource.number ?? resource.title}`;
    setSelecting(key);
    try {
      await onSelect(resource);
      close();
    } finally {
      setSelecting(null);
    }
  };

  return (
    <>
      <button ref={triggerRef} type="button" disabled={disabled} onClick={() => setOpen(true)} className="text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] disabled:cursor-not-allowed disabled:opacity-50">
        {triggerLabel}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Search GitHub resources" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div className="flex max-h-[calc(100vh-32px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]">
            <div className="flex items-center justify-between border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
              <div><h2 className="text-sm font-semibold text-[var(--ledger-text-primary)]">Search GitHub</h2><p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">Approved repositories and linked GitHub work only.</p></div>
              <button type="button" aria-label="Close GitHub resource picker" onClick={close} className="rounded-md p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"><X size={15} /></button>
            </div>
            <div className="p-4">
              <label className="flex h-9 items-center gap-2 rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 text-xs text-[var(--ledger-text-muted)] focus-within:border-[color:var(--ledger-border-strong)]">
                <Search size={14} aria-hidden="true" />
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search approved repositories, issues, and pull requests" className="min-w-0 flex-1 bg-transparent text-xs text-[var(--ledger-text-primary)] outline-none" />
              </label>
              <div className="mt-3 flex gap-1" role="tablist" aria-label="GitHub resource type">
                {([['all', 'All'], ['repository', 'Repositories'], ['issue', 'Issues'], ['pull_request', 'Pull requests']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={type === value} onClick={() => setType(value)} className={`rounded-md px-2 py-1 text-[11px] ${type === value ? 'bg-[var(--ledger-surface-hover)] font-medium text-[var(--ledger-text-primary)]' : 'text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]'}`}>{label}</button>)}
              </div>
              {type !== 'repository' && <select aria-label="Approved repository" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)} className="mt-2 h-8 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-transparent px-2 text-xs text-[var(--ledger-text-secondary)]"><option value="">All approved repositories</option>{repositories.filter((repo) => !repo.is_archived).map((repo) => <option key={repo.github_repository_id} value={repo.github_repository_id}>{repo.full_name}{repo.is_private ? ' · Private' : ''}</option>)}</select>}
              <div className="mt-3 min-h-0 max-h-72 overflow-y-auto" aria-live="polite">
                {loading ? <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--ledger-text-muted)]"><Loader2 size={14} className="animate-spin" />Searching approved GitHub resources…</div> : error ? <p className="py-8 text-center text-xs text-[var(--ledger-text-muted)]">{error}</p> : results.length === 0 ? <p className="py-8 text-center text-xs text-[var(--ledger-text-muted)]">{query.trim().length < 2 ? 'Start typing to search approved GitHub resources.' : 'No approved GitHub work matches this search.'}</p> : <div className="space-y-0.5">{results.map((resource) => { const key = resource.referenceId ?? resource.canonicalUrl ?? `${resource.resourceType}:${resource.number ?? resource.title}`; const alreadyAttached = Boolean(resource.referenceId && existingReferenceIds.includes(resource.referenceId)); const isRepository = resource.resourceType === 'repository'; const unavailable = isRepository && Boolean(resource.isArchived); const label = isRepository ? resource.repositoryFullName ?? resource.title ?? 'Repository' : `${resource.resourceType === 'pull_request' ? 'PR' : 'Issue'} #${resource.number ?? ''}`; return <button key={key} type="button" disabled={alreadyAttached || unavailable || Boolean(selecting)} onClick={() => void select(resource)} className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-[var(--ledger-surface-hover)] disabled:cursor-default disabled:opacity-60"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--ledger-surface-muted)]"><img src="/github-mark.svg" alt="" className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[var(--ledger-text-primary)]">{isRepository ? label : `${label} · ${resource.title ?? ''}`}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--ledger-text-muted)]">{isRepository ? `${resource.isArchived ? 'Archived' : resource.isPrivate ? 'Private' : 'Public'}${resource.defaultBranch ? ` · ${resource.defaultBranch}` : ''}` : `${resource.repositoryFullName ?? 'Approved repository'} · ${resource.state ?? 'Available'}`}</span></span>{alreadyAttached ? <span className="text-[11px] text-[var(--ledger-text-muted)]">Already attached</span> : unavailable ? <span className="text-[11px] text-[var(--ledger-text-muted)]">Unavailable</span> : selecting === key ? <Loader2 size={13} className="animate-spin text-[var(--ledger-text-muted)]" /> : null}</button>; })}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
