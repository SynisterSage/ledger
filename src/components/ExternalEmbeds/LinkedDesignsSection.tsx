import { useEffect, useMemo, useState } from 'react';
import { Check, FileImage, Link2, Loader2, MoreHorizontal, Search, X } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';
import type { ExternalEmbedTargetType } from './ExternalEmbedNode';

export type LinkedDesignTarget = { workspaceId: string; targetType: ExternalEmbedTargetType; targetId: string };
type Reference = { id: string; external_url?: string; normalized_url?: string; external_type?: string; metadata?: Record<string, unknown>; access_status?: string };
type Link = { id: string; external_reference_id: string; sources?: string[]; external_references?: Reference | Reference[] };
type Preview = { url?: string | null; capturedAt?: string | null };

const openExternal = (url: string) => window.desktopWindow?.openExternal ? void window.desktopWindow.openExternal(url) : window.open(url, '_blank', 'noopener,noreferrer');
const formatDate = (value?: string | null) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null;
const resourceLabel = (reference: Reference) => String(reference.metadata?.nodeType ?? reference.external_type ?? 'File').replace(/_/g, ' ').replace(/\b\w/g, (v) => v.toUpperCase());
const referenceTitle = (reference: Reference) => String(reference.metadata?.nodeName ?? reference.metadata?.fileName ?? reference.normalized_url ?? reference.external_url ?? 'Figma design');

export function LinkedDesignsSection({ target, canEdit = true, canInsert = false, onInsert }: { target: LinkedDesignTarget; canEdit?: boolean; canInsert?: boolean; onInsert?: (reference: { id: string; url: string }) => void }) {
  const api = useApi();
  const toast = useToast();
  const [links, setLinks] = useState<Link[]>([]);
  const [previews, setPreviews] = useState<Record<string, Preview | null>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<'paste' | 'existing'>('paste');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [existing, setExisting] = useState<Reference[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locations, setLocations] = useState<{ target_type: string; target_id: string; title: string }[] | null>(null);
  const [menuLink, setMenuLink] = useState<Link | null>(null);
  const [consentReference, setConsentReference] = useState<Reference | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.getExternalReferencesForTarget(target.targetType, target.targetId) as Link[];
      setLinks(rows);
      const entries = await Promise.all(rows.map(async (link) => {
        try { return [link.external_reference_id, (await api.getExternalReferencePreview(link.external_reference_id, target.targetType, target.targetId) as { preview?: Preview | null }).preview ?? null] as const; }
        catch { return [link.external_reference_id, null] as const; }
      }));
      setPreviews(Object.fromEntries(entries));
    } catch { toast.show('Could not load linked designs.', { variant: 'error' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [target.targetId, target.targetType]);
  useEffect(() => {
    if (mode !== 'existing') return;
    const timer = window.setTimeout(() => { void api.searchExternalReferences(query).then((rows) => setExisting(Array.isArray(rows) ? rows as Reference[] : [])).catch(() => setExisting([])); }, 180);
    return () => window.clearTimeout(timer);
  }, [api, mode, query]);

  const linkReference = async (reference: Reference) => {
    if (!canEdit) return;
    if (links.some((link) => link.external_reference_id === reference.id)) { toast.show('Already linked', { variant: 'info' }); setDialogOpen(false); return; }
    setBusyId(reference.id);
    try {
      await api.linkExternalReference(reference.id, target.targetType, target.targetId, 'manual');
      try { await api.resolveExternalReference(reference.id); } catch { /* metadata-limited links remain valid */ }
      const privacy = await api.getFigmaPrivacySettings() as { preview_sharing_accepted?: boolean };
      if (!privacy.preview_sharing_accepted) setConsentReference(reference);
      else { try { await api.createExternalReferencePreview(reference.id, target.targetType, target.targetId); } catch { /* connection-required links remain visible */ } }
      setDialogOpen(false); setUrl(''); setQuery(''); await load();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not link this Figma design.', { variant: 'error' }); }
    finally { setBusyId(null); }
  };
  const pasteLink = async () => {
    if (!url.trim()) return;
    setBusyId('paste');
    try {
      const reference = await api.createExternalReference('figma', url.trim()) as Reference;
      await linkReference(reference);
    } catch (error) { toast.show(error instanceof Error ? error.message : 'That is not a supported Figma link.', { variant: 'error' }); }
    finally { setBusyId(null); }
  };
  const unlink = async (link: Link) => {
    if (!canEdit) return;
    if (!window.confirm('Unlink this Figma design from this item?')) return;
    setBusyId(link.id);
    try { await api.unlinkExternalReference(link.external_reference_id, link.id, 'manual'); await load(); }
    catch { toast.show('Could not unlink this design.', { variant: 'error' }); }
    finally { setBusyId(null); }
  };
  const refresh = async (link: Link) => {
    if (!canEdit) return;
    setBusyId(link.id);
    try { const result = await api.refreshExternalReferencePreview(link.external_reference_id, target.targetType, target.targetId) as { preview?: Preview | null; error?: string }; if (result.preview) setPreviews((current) => ({ ...current, [link.external_reference_id]: result.preview ?? null })); if (result.error) toast.show(result.error, { variant: 'error' }); }
    catch { toast.show('Ledger couldn’t refresh this Figma preview.', { variant: 'error' }); }
    finally { setBusyId(null); }
  };
  const showLocations = async (referenceId: string) => { try { setLocations(await api.getExternalReferenceLinkedTargets(referenceId) as { target_type: string; target_id: string; title: string }[]); } catch { toast.show('Could not load linked locations.', { variant: 'error' }); } };
  const acceptConsentAndPreview = async () => { if (!consentReference) return; setBusyId(consentReference.id); try { await api.acceptFigmaPrivacySettings(); await api.createExternalReferencePreview(consentReference.id, target.targetType, target.targetId); setConsentReference(null); await load(); } catch { toast.show('Preview sharing was not enabled. The Figma link remains linked.', { variant: 'error' }); } finally { setBusyId(null); } };

  const rows = useMemo(() => links.map((link) => ({ link, reference: (Array.isArray(link.external_references) ? link.external_references[0] : link.external_references) as Reference | undefined })).filter((row) => row.reference), [links]);
  return <section className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4" aria-labelledby={`linked-designs-${target.targetId}`}>
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><p id={`linked-designs-${target.targetId}`} className="text-xs font-semibold text-[var(--ledger-text-primary)]">Linked designs</p>{rows.length > 0 && <span className="text-[11px] text-[var(--ledger-text-muted)]">{rows.length}</span>}</div>{canEdit && <button type="button" onClick={() => setDialogOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ledger-accent)] hover:text-[var(--ledger-accent-hover)]"><Link2 size={12} />Link design</button>}</div>
    {loading ? <div className="flex items-center gap-2 py-3 text-xs text-[var(--ledger-text-muted)]"><Loader2 size={13} className="animate-spin" />Loading linked designs…</div> : rows.length === 0 ? <div className="rounded-lg border border-dashed border-[color:var(--ledger-border-subtle)] px-3 py-3 text-xs text-[var(--ledger-text-muted)]">Keep related Figma files and frames connected to this work.{canEdit && <button type="button" className="ml-1 font-medium text-[var(--ledger-accent)]" onClick={() => setDialogOpen(true)}>Link design</button>}</div> : <div className="divide-y divide-[color:var(--ledger-border-subtle)] rounded-lg border border-[color:var(--ledger-border-subtle)]">{rows.map(({ link, reference }) => { const preview = previews[link.external_reference_id]; const refUrl = reference?.normalized_url || reference?.external_url || ''; return <div key={link.id} className="relative flex items-center gap-2 px-2.5 py-2"><div className="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--ledger-surface-muted)]">{preview?.url ? <img src={preview.url} alt={referenceTitle(reference!)} className="h-full w-full object-cover" /> : <FileImage size={15} className="text-[var(--ledger-text-muted)]" />}</div><button type="button" className="min-w-0 flex-1 text-left" onClick={() => refUrl && openExternal(refUrl)}><p className="truncate text-xs font-medium text-[var(--ledger-text-primary)]">{referenceTitle(reference!)}</p><p className="truncate text-[11px] text-[var(--ledger-text-muted)]">Figma · {resourceLabel(reference!)}{preview?.capturedAt ? ` · Preview captured ${formatDate(preview.capturedAt)}` : ''}</p></button>{canInsert && onInsert && <button type="button" title="Insert into description" aria-label="Insert into description" onClick={() => onInsert({ id: reference!.id, url: refUrl })} className="rounded-md p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"><Check size={13} /></button>}<button type="button" aria-label="Design actions" onClick={() => setMenuLink(menuLink?.id === link.id ? null : link)} className="rounded-md p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"><MoreHorizontal size={14} /></button>{busyId === link.id && <Loader2 size={13} className="animate-spin text-[var(--ledger-accent)]" />}<div className="sr-only">{link.sources?.join(', ')}</div>{menuLink?.id === link.id && <div className="absolute right-2 top-10 z-20 w-44 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"><button type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]" onClick={() => { openExternal(refUrl); setMenuLink(null); }}>Open in Figma</button><button type="button" disabled={!canEdit} className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50" onClick={() => { void refresh(link); setMenuLink(null); }}>Refresh preview</button><button type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]" onClick={() => { void navigator.clipboard.writeText(refUrl); setMenuLink(null); }}>Copy Figma link</button>{canInsert && onInsert && <button type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]" onClick={() => { onInsert({ id: reference!.id, url: refUrl }); setMenuLink(null); }}>Insert into description</button>}<button type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]" onClick={() => { void showLocations(reference!.id); setMenuLink(null); }}>View linked locations</button>{canEdit && <button type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]" onClick={() => { void unlink(link); setMenuLink(null); }}>Unlink from this item</button>}</div>}</div>; })}</div>}
    {dialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Link a Figma design" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}><div className="w-full max-w-md rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-4 shadow-[var(--ledger-shadow)]"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-[var(--ledger-text-primary)]">Link a Figma design</h3><button type="button" aria-label="Close" onClick={() => setDialogOpen(false)}><X size={15} /></button></div><div className="mt-3 flex gap-1 rounded-lg bg-[var(--ledger-surface-muted)] p-1"><button type="button" onClick={() => setMode('paste')} className={`flex-1 rounded-md px-2 py-1.5 text-xs ${mode === 'paste' ? 'bg-[var(--ledger-surface-card)] font-medium' : 'text-[var(--ledger-text-muted)]'}`}>Paste link</button><button type="button" onClick={() => setMode('existing')} className={`flex-1 rounded-md px-2 py-1.5 text-xs ${mode === 'existing' ? 'bg-[var(--ledger-surface-card)] font-medium' : 'text-[var(--ledger-text-muted)]'}`}>Choose existing</button></div>{mode === 'paste' ? <><label className="mt-4 block text-xs text-[var(--ledger-text-muted)]" htmlFor="figma-link-input">Paste a Figma link</label><input id="figma-link-input" autoFocus value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setDialogOpen(false); if (event.key === 'Enter') void pasteLink(); }} placeholder="https://figma.com/design/..." className="mt-1 h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-transparent px-2 text-xs outline-none focus:border-[color:var(--ledger-border-strong)]" /></> : <div className="mt-3"><div className="flex items-center gap-2 rounded-md border border-[color:var(--ledger-border-subtle)] px-2"><Search size={13} className="text-[var(--ledger-text-muted)]" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search file or node name" className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none" /></div><div className="mt-2 max-h-52 overflow-y-auto">{existing.map((reference) => <button type="button" key={reference.id} onClick={() => void linkReference(reference)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--ledger-surface-hover)]"><FileImage size={14} className="text-[var(--ledger-text-muted)]" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{referenceTitle(reference)}</span><span className="block truncate text-[11px] text-[var(--ledger-text-muted)]">Figma · {resourceLabel(reference)}</span></span></button>)}</div></div>}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setDialogOpen(false)} className="h-8 rounded-md px-3 text-xs text-[var(--ledger-text-secondary)]">Cancel</button>{mode === 'paste' && <button type="button" onClick={() => void pasteLink()} disabled={!url.trim() || Boolean(busyId)} className="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white disabled:opacity-60">{busyId === 'paste' && <Loader2 size={12} className="animate-spin" />}Link design</button>}</div></div></div>}
    {locations && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 p-4" role="dialog" aria-label="Linked in Ledger" onMouseDown={(event) => { if (event.target === event.currentTarget) setLocations(null); }}><div className="w-full max-w-sm rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-4 shadow-[var(--ledger-shadow)]"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Linked in Ledger</h3><button type="button" onClick={() => setLocations(null)} aria-label="Close"><X size={15} /></button></div><div className="mt-3 space-y-1">{locations.map((location) => <div key={`${location.target_type}:${location.target_id}`} className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs"><span className="truncate">{location.title}</span><span className="ml-2 shrink-0 text-[var(--ledger-text-muted)]">{location.target_type}</span></div>)}</div></div></div>}
    {consentReference && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Share Figma previews"><div className="w-full max-w-sm rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-4 shadow-[var(--ledger-shadow)]"><h3 className="text-sm font-semibold">Share Figma previews in Ledger?</h3><p className="mt-2 text-xs leading-5 text-[var(--ledger-text-secondary)]">People who can access a Ledger item will be able to view its saved Figma preview, even if they cannot open the original Figma file.</p><div className="mt-4 flex justify-end gap-2"><button type="button" className="h-8 rounded-md px-3 text-xs" onClick={() => setConsentReference(null)}>Cancel</button><button type="button" className="h-8 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white disabled:opacity-60" onClick={() => void acceptConsentAndPreview()} disabled={Boolean(busyId)}>Allow previews</button></div></div></div>}
  </section>;
}
