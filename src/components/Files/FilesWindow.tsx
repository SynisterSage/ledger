import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, HardDrive, Link2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { LedgerEmptyState } from '../Common/LedgerEmptyState';
import { ModuleHeaderActionButton, ModuleHeaderSegmentedButton, ModuleHeaderSegmentedGroup, ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import type { LocalContextFile } from '../../types/localContextLibrary';

type ExternalReference = { id: string; provider?: string | null; external_url?: string | null; external_type?: string | null; metadata?: Record<string, unknown> | null; access_status?: string | null };
type LibraryFilter = 'all' | 'local' | 'connected';
type SelectedItem = { kind: 'local'; file: LocalContextFile } | { kind: 'connected'; reference: ExternalReference };

const providerLabel = (provider?: string | null) => {
  const value = String(provider ?? '').trim().toLowerCase();
  if (value === 'google_drive') return 'Google Drive';
  if (!value) return 'Connected service';
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
};
const referenceTitle = (reference: ExternalReference) => {
  const metadata = reference.metadata ?? {};
  return String(metadata.fileName ?? metadata.name ?? metadata.nodeName ?? metadata.fullName ?? metadata.title ?? reference.external_url ?? 'Linked resource');
};
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;

export default function FilesWindow() {
  const api = useApi();
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const [files, setFiles] = useState<LocalContextFile[]>([]);
  const [references, setReferences] = useState<ExternalReference[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'import' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id || !activeWorkspaceId || !window.localContext) { setFiles([]); setReferences([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [localSummary, connected] = await Promise.all([
        window.localContext.list({ ownerUserId: user.id, workspaceId: activeWorkspaceId }),
        api.searchExternalReferences(''),
      ]);
      setFiles(localSummary.files ?? []);
      setReferences(Array.isArray(connected) ? connected as ExternalReference[] : []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load Files & links.'); }
    finally { setLoading(false); }
  }, [activeWorkspaceId, api, user?.id]);
  useEffect(() => { void load(); }, [load]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const localItems: SelectedItem[] = files.filter(() => filter !== 'connected').filter((file) => !needle || file.name.toLowerCase().includes(needle)).map((file) => ({ kind: 'local', file }));
    const connectedItems: SelectedItem[] = references.filter(() => filter !== 'local').filter((reference) => !needle || `${referenceTitle(reference)} ${providerLabel(reference.provider)}`.toLowerCase().includes(needle)).map((reference) => ({ kind: 'connected', reference }));
    return [...localItems, ...connectedItems];
  }, [files, filter, query, references]);

  const importLocalFiles = async () => {
    if (!user?.id || !activeWorkspaceId || !window.localContext) return;
    setBusy('import'); setError(null);
    try { const result = await window.localContext.importFiles({ ownerUserId: user.id, workspaceId: activeWorkspaceId }); if (!result.canceled) await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import that file.'); }
    finally { setBusy(null); }
  };
  const removeSelectedLocalFile = async () => {
    if (selected?.kind !== 'local' || !user?.id || !activeWorkspaceId || !window.localContext) return;
    if (!window.confirm(`Remove “${selected.file.name}” from Ledger? The original file will not be deleted.`)) return;
    setBusy('remove');
    try { await window.localContext.remove({ ownerUserId: user.id, workspaceId: activeWorkspaceId, fileId: selected.file.id }); setSelected(null); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove that local file.'); }
    finally { setBusy(null); }
  };
  const openSelected = async () => {
    if (!selected) return;
    if (selected.kind === 'local' && user?.id && activeWorkspaceId && window.localContext) {
      const result = await window.localContext.open({ ownerUserId: user.id, workspaceId: activeWorkspaceId, fileId: selected.file.id });
      if (!result.ok) setError(result.error ?? 'This local file is no longer available.');
    } else if (selected.kind === 'connected' && selected.reference.external_url) await window.desktopWindow?.openExternal(selected.reference.external_url);
  };
  const subtitle = activeWorkspace?.name ? `${activeWorkspace.name} · ${files.length} local · ${references.length} connected` : 'Local context and connected references';

  return <div className="flex h-screen flex-col overflow-hidden rounded-[var(--ledger-window-radius)] bg-[var(--ledger-background)]">
    <ModuleWindowHeader eyebrow="Context library" title="Files & links" subtitle={subtitle} icon={<Link2 size={18} className="text-[var(--ledger-accent)]" />} onClose={() => void window.desktopWindow?.closeModule('files')} onMinimize={() => void window.desktopWindow?.minimizeModule('files')} onToggleFullscreen={() => void window.desktopWindow?.toggleModuleFullscreen('files')} compact showBodyHeader={false}
      viewControls={<ModuleHeaderSegmentedGroup compact>{(['all', 'local', 'connected'] as const).map((value) => <ModuleHeaderSegmentedButton key={value} compact active={filter === value} title={`Show ${value === 'all' ? 'all context' : value === 'local' ? 'local files' : 'connected links'}`} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'local' ? 'On this device' : 'Connected'}</ModuleHeaderSegmentedButton>)}</ModuleHeaderSegmentedGroup>}
      actions={<ModuleHeaderActionButton title="Import a local file" ariaLabel="Import a local file" onClick={() => void importLocalFiles()} icon={<Plus size={13} />} disabled={busy !== null}>Import local file</ModuleHeaderActionButton>}
    />
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]">
        <div className="border-b border-[color:var(--ledger-border-subtle)] p-3"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and links" aria-label="Search files and links" className="h-8 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 text-xs text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)] focus:border-[var(--ledger-accent)]" /></div>
        <div className="min-h-0 flex-1 overflow-y-auto">{loading ? <p className="p-4 text-xs text-[var(--ledger-text-muted)]">Loading context…</p> : visibleItems.length ? visibleItems.map((item) => { const isSelected = selected && ((item.kind === 'local' && selected.kind === 'local' && selected.file.id === item.file.id) || (item.kind === 'connected' && selected.kind === 'connected' && selected.reference.id === item.reference.id)); const title = item.kind === 'local' ? item.file.name : referenceTitle(item.reference); const meta = item.kind === 'local' ? `On this device · ${formatBytes(item.file.sizeBytes)}` : `${providerLabel(item.reference.provider)} · ${item.reference.access_status ?? 'Linked'}`; return <button key={`${item.kind}:${item.kind === 'local' ? item.file.id : item.reference.id}`} type="button" onClick={() => setSelected(item)} className={`flex w-full items-center gap-2.5 border-b border-[color:var(--ledger-border-subtle)] px-3 py-2.5 text-left transition ${isSelected ? 'bg-[color:rgba(255,95,64,0.10)]' : 'hover:bg-[var(--ledger-surface-hover)]'}`}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-muted)]">{item.kind === 'local' ? <FileText size={14} /> : <Link2 size={14} />}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[var(--ledger-text-primary)]">{title}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--ledger-text-muted)]">{meta}</span></span></button>; }) : <LedgerEmptyState state="first-use" testId="files-empty" title="No context yet" description={filter === 'connected' ? 'Connect a provider to see links here.' : 'Import a file when it becomes useful to your work.'} primaryAction={filter !== 'connected' ? { label: 'Import local file', onClick: () => void importLocalFiles() } : undefined} />}</div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--ledger-surface-card)]">{error ? <div className="m-5 rounded-lg border border-[color:var(--ledger-danger)]/20 bg-[color:var(--ledger-danger)]/5 px-3 py-2 text-xs text-[var(--ledger-danger)]">{error}</div> : null}{selected ? <div className="mx-auto max-w-2xl p-8"><div className="flex items-start gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-accent)]">{selected.kind === 'local' ? <HardDrive size={21} /> : <Link2 size={21} />}</div><div className="min-w-0 flex-1"><p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ledger-text-muted)]">{selected.kind === 'local' ? 'Local file' : providerLabel(selected.reference.provider)}</p><h1 className="mt-1 break-words text-xl font-semibold text-[var(--ledger-text-primary)]">{selected.kind === 'local' ? selected.file.name : referenceTitle(selected.reference)}</h1><p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">{selected.kind === 'local' ? 'Stored only on this device. It is not shared with your workspace.' : selected.reference.external_url}</p></div></div><div className="mt-8 divide-y divide-[color:var(--ledger-border-subtle)] border-y border-[color:var(--ledger-border-subtle)]"><div className="flex items-center gap-3 py-3"><ShieldCheck size={15} className="text-[var(--ledger-accent)]" /><span className="text-xs text-[var(--ledger-text-secondary)]">{selected.kind === 'local' ? 'Ledger keeps the file on this device' : 'The original stays with the connected provider'}</span></div>{selected.kind === 'local' ? <div className="flex justify-between py-3 text-xs"><span className="text-[var(--ledger-text-muted)]">Size</span><span className="text-[var(--ledger-text-primary)]">{formatBytes(selected.file.sizeBytes)}</span></div> : null}{selected.kind === 'local' && selected.file.links.length > 0 ? <div className="py-3 text-xs"><span className="text-[var(--ledger-text-muted)]">Used with</span><span className="mt-1 block text-[var(--ledger-text-primary)]">{selected.file.links.length} Ledger item{selected.file.links.length === 1 ? '' : 's'}</span></div> : null}</div><div className="mt-5 flex items-center gap-2"><button type="button" onClick={() => void openSelected()} className="inline-flex h-8 items-center gap-2 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white"><ExternalLink size={13} />{selected.kind === 'local' ? 'Open file' : 'Open original'}</button>{selected.kind === 'local' ? <button type="button" onClick={() => void removeSelectedLocalFile()} disabled={busy !== null} className="inline-flex h-8 items-center gap-2 rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs text-[var(--ledger-danger)] disabled:opacity-50"><Trash2 size={13} />Remove local copy</button> : null}</div></div> : <div className="flex h-full items-center justify-center p-8"><LedgerEmptyState state="first-use" testId="files-detail-empty" title="Choose some context" description="Select a file or link to see where it lives and how Ledger can use it." primaryAction={{ label: 'Import local file', onClick: () => void importLocalFiles() }} /></div>}</main>
    </div>
  </div>;
}
