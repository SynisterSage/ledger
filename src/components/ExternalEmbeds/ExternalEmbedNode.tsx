import React, { createContext, useContext, useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2, MoreHorizontal, Plug2, RefreshCw, Unlink, X } from 'lucide-react';
import { DecoratorNode, type DOMConversionMap, type DOMExportOutput, type LexicalNode, type NodeKey, type SerializedLexicalNode, $applyNodeReplacement, $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, $isElementNode } from 'lexical';
import { $createLinkNode } from '@lexical/link';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';

export type ExternalEmbedTargetType = 'note' | 'meetingNote' | 'task' | 'project' | 'intake';
export type ExternalEmbedTarget = { targetType: ExternalEmbedTargetType; targetId: string | null };
export type SerializedExternalEmbedNode = SerializedLexicalNode & {
  type: 'external-embed' | 'figma-embed';
  version: 1;
  provider: 'figma';
  externalReferenceId: string;
  externalUrl: string;
};

type ExternalEmbedContextValue = ExternalEmbedTarget & { canEdit: boolean };
const ExternalEmbedContext = createContext<ExternalEmbedContextValue>({ targetType: 'note', targetId: null, canEdit: true });
export const ExternalEmbedProvider = ({ targetType = 'note', targetId, canEdit, children }: ExternalEmbedContextValue & { children: React.ReactNode }) => (
  <ExternalEmbedContext.Provider value={{ targetType, targetId, canEdit }}>{children}</ExternalEmbedContext.Provider>
);

type ExternalReference = { id: string; provider?: string; normalized_url?: string; external_url?: string; metadata?: Record<string, unknown>; access_status?: string };
type ExternalPreview = { url?: string | null; capturedAt?: string | null; sourceLastModifiedAt?: string | null; status?: string };

const openExternal = (url: string) => {
  if (window.desktopWindow?.openExternal) void window.desktopWindow.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
};
const formatCapturedAt = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const ExternalEmbedRenderer = ({ nodeKey, externalReferenceId, externalUrl }: { nodeKey: NodeKey; externalReferenceId: string; externalUrl: string }) => {
  const [editor] = useLexicalComposerContext();
  const api = useApi();
  const toast = useToast();
  const { targetType, targetId, canEdit } = useContext(ExternalEmbedContext);
  const [reference, setReference] = useState<ExternalReference | null>(null);
  const [preview, setPreview] = useState<ExternalPreview | null>(null);
  const [accessStatus, setAccessStatus] = useState('unresolved');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [changeState, setChangeState] = useState<'unknown' | 'current' | 'updated' | 'checking' | 'unavailable' | 'error'>('unknown');

  const load = async () => {
    if (!targetId) { setLoading(false); return; }
    setLoading(true);
    try {
      const links = await api.getExternalReferencesForTarget(targetType, targetId) as Array<{ external_reference_id?: string; external_references?: ExternalReference | ExternalReference[] }>;
      const link = links.find((item) => item.external_reference_id === externalReferenceId);
      const value = Array.isArray(link?.external_references) ? link?.external_references[0] : link?.external_references;
      if (value) { setReference(value); setAccessStatus(value.access_status ?? 'unresolved'); }
      const result = await api.getExternalReferencePreview(externalReferenceId, targetType, targetId) as { preview?: ExternalPreview | null };
      let nextPreview = result.preview ?? null;
      // A newly linked design has no saved snapshot yet. Use the existing
      // server-side capture endpoint rather than leaving the embed in a
      // permanent "preview unavailable" state. Consent and connection
      // requirements are returned by the server and remain non-blocking.
      if (!nextPreview?.url && value?.provider === 'figma') {
        try {
          const capture = await api.createExternalReferencePreview(externalReferenceId, targetType, targetId) as { preview?: ExternalPreview | null; accessStatus?: string; consentRequired?: boolean };
          nextPreview = capture.preview ?? null;
          if (capture.accessStatus) setAccessStatus(capture.accessStatus);
          if (capture.consentRequired) setAccessStatus('consent_required');
        } catch { /* The saved-link state remains visible when capture is unavailable. */ }
      }
      setPreview(nextPreview);
      const change = await api.getExternalReferenceChangeState(externalReferenceId, targetType, targetId) as { change_state?: { change_state?: typeof changeState } };
      setChangeState(change.change_state?.change_state || 'unknown');
    } catch { setAccessStatus('error'); }
    finally { setLoading(false); }
  };
  const checkForUpdates = async () => { if (!targetId) return; setChangeState('checking'); try { const result = await api.checkExternalReferenceChangeState(externalReferenceId, targetType, targetId) as { change_state?: { change_state?: typeof changeState } }; setChangeState(result.change_state?.change_state || 'unknown'); } catch { setChangeState('error'); } finally { setMenuOpen(false); } };
  useEffect(() => { void load(); }, [externalReferenceId, targetId, targetType]);

  const refresh = async () => {
    if (!targetId || !canEdit) return;
    setRefreshing(true);
    try {
      const result = await api.refreshExternalReferencePreview(externalReferenceId, targetType, targetId) as { preview?: ExternalPreview | null; accessStatus?: string; error?: string };
      if (result.preview) setPreview(result.preview);
      if (result.accessStatus) setAccessStatus(result.accessStatus);
      setChangeState('current');
      toast.show(result.error || 'Figma preview refreshed', { variant: result.error ? 'error' : 'success' });
    } catch { toast.show('Ledger couldn’t refresh this Figma preview.', { variant: 'error' }); }
    finally { setRefreshing(false); setMenuOpen(false); }
  };

  const remove = async (convertToLink: boolean) => {
    if (!canEdit || !targetId) return;
    try {
      const links = await api.getExternalReferencesForTarget(targetType, targetId) as Array<{ id?: string; external_reference_id?: string }>;
      const link = links.find((item) => item.external_reference_id === externalReferenceId);
      let anotherEmbedUsesReference = false;
      editor.getEditorState().read(() => {
        const visit = (node: LexicalNode) => {
          if ($isExternalEmbedNode(node) && node.getKey() !== nodeKey && node.getExternalReferenceId() === externalReferenceId) anotherEmbedUsesReference = true;
          if ($isElementNode(node)) node.getChildren().forEach(visit);
        };
        $getRoot().getChildren().forEach(visit);
      });
      if (link?.id && !anotherEmbedUsesReference) await api.unlinkExternalReference(externalReferenceId, link.id, 'embed');
      editor.update(() => {
        const lexicalNode = $getNodeByKey(nodeKey);
        if (!lexicalNode) return;
        if (convertToLink) {
          const paragraph = $createParagraphNode();
          const linkNode = $createLinkNode(externalUrl);
          linkNode.append($createTextNode(externalUrl));
          paragraph.append(linkNode);
          lexicalNode.replace(paragraph);
        } else lexicalNode.remove();
      });
    } catch { toast.show('Could not update this Figma embed.', { variant: 'error' }); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(externalUrl); setCopyState(true); window.setTimeout(() => setCopyState(false), 1400); }
    catch { toast.show('Could not copy the Figma link.', { variant: 'error' }); }
    setMenuOpen(false);
  };

  const metadata = reference?.metadata ?? {};
  const fileName = String(metadata.fileName ?? 'Figma design');
  const nodeName = metadata.nodeName ? String(metadata.nodeName) : null;
  const nodeType = metadata.nodeType ? String(metadata.nodeType).toLowerCase().replace(/_/g, ' ') : 'File';
  const statusMessage = accessStatus === 'connection_required' ? 'Figma is not connected for this workspace.' : accessStatus === 'consent_required' ? 'Preview sharing is not enabled for this workspace.' : accessStatus === 'revoked' || accessStatus === 'expired' ? 'The Figma connection needs to be renewed.' : accessStatus === 'inaccessible' ? 'This Figma design is not accessible to the connected account.' : accessStatus === 'not_found' ? 'This Figma design or frame is no longer available.' : accessStatus === 'error' ? 'Ledger couldn’t load this Figma preview.' : null;

  return <ExternalEmbedShell nodeKey={nodeKey} loading={loading} preview={preview} previewAlt={nodeName || fileName} statusMessage={statusMessage || 'Preview unavailable for this file-level link.'} onPreviewClick={() => setExpanded(true)}>
    <div className="flex items-center gap-3 border-t border-[color:var(--ledger-border-subtle)] px-3 py-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]"><Plug2 size={15} /></span><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">{nodeName || fileName}</p><p className="truncate text-[11px] text-[var(--ledger-text-muted)]">Figma · {nodeType}{preview?.capturedAt ? ` · Preview captured ${formatCapturedAt(preview.capturedAt)}` : ''}</p></div><button type="button" onClick={() => openExternal(externalUrl)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">Open in Figma <ExternalLink size={12} /></button><button type="button" aria-label="Figma embed actions" onClick={() => setMenuOpen((value) => !value)} className="rounded-md p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"><MoreHorizontal size={15} /></button></div>
    {copyState && <span className="px-3 pb-2 text-[11px] text-[var(--ledger-text-muted)]">Link copied</span>}
    {changeState === 'updated' && <div className="flex items-center justify-between gap-3 border-t border-[color:var(--ledger-border-subtle)] px-3 py-2 text-[11px] text-[var(--ledger-text-secondary)]"><span>Design updated · saved preview unchanged</span><button type="button" className="font-medium hover:text-[var(--ledger-text-primary)]" onClick={() => void refresh()} disabled={refreshing || !canEdit}>{refreshing ? 'Refreshing…' : 'Refresh preview'}</button></div>}
    {menuOpen && <ExternalEmbedMenu onCheck={() => void checkForUpdates()} onRefresh={() => void refresh()} onCopy={() => void copyLink()} onConvert={() => void remove(true)} onRemove={() => void remove(false)} refreshing={refreshing} canEdit={canEdit} />}
    {expanded && preview?.url && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-label="Expanded Figma preview" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}><div className="relative max-h-full max-w-5xl overflow-hidden rounded-xl bg-[var(--ledger-surface-card)] p-2"><button type="button" aria-label="Close preview" onClick={() => setExpanded(false)} className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-1.5 text-white"><X size={15} /></button><img src={preview.url} alt={nodeName || fileName} className="max-h-[85vh] max-w-[90vw] object-contain" /></div></div>}
  </ExternalEmbedShell>;
};

const ExternalEmbedShell = ({ nodeKey, loading, preview, previewAlt, statusMessage, onPreviewClick, children }: { nodeKey: NodeKey; loading: boolean; preview: ExternalPreview | null; previewAlt: string; statusMessage: string; onPreviewClick: () => void; children: React.ReactNode }) => <div className="my-4 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]" data-external-embed-node-key={nodeKey}>{loading ? <div className="flex h-32 items-center justify-center gap-2 text-xs text-[var(--ledger-text-muted)]"><Loader2 size={15} className="animate-spin text-[var(--ledger-accent)]" />Loading Figma design…</div> : preview?.url ? <button type="button" aria-label="Open larger Figma preview" onClick={onPreviewClick} className="block w-full cursor-zoom-in bg-[var(--ledger-surface-muted)]"><img src={preview.url} alt={previewAlt} className="block max-h-[360px] w-full object-contain" /></button> : <div className="flex min-h-28 items-center justify-center bg-[var(--ledger-surface-muted)] px-5 text-center text-xs text-[var(--ledger-text-muted)]">{statusMessage}</div>}{children}</div>;
const ExternalEmbedMenu = ({ onCheck, onRefresh, onCopy, onConvert, onRemove, refreshing, canEdit }: { onCheck: () => void; onRefresh: () => void; onCopy: () => void; onConvert: () => void; onRemove: () => void; refreshing: boolean; canEdit: boolean }) => <div className="relative ml-auto mr-3 mb-3 w-44 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-lg"><button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]" onClick={onCheck}><RefreshCw size={13} />Check for updates</button><button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]" onClick={onRefresh} disabled={refreshing || !canEdit}><RefreshCw size={13} />Refresh preview</button><button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]" onClick={onCopy}><Copy size={13} />Copy Figma link</button><button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]" onClick={onConvert} disabled={!canEdit}><Unlink size={13} />Convert to link</button><button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]" onClick={onRemove} disabled={!canEdit}><X size={13} />Remove embed</button></div>;

export class ExternalEmbedNode extends DecoratorNode<React.ReactNode> {
  __externalReferenceId: string; __externalUrl: string;
  static getType(): string { return 'figma-embed'; }
  static clone(node: ExternalEmbedNode): ExternalEmbedNode { return new ExternalEmbedNode(node.__externalReferenceId, node.__externalUrl, node.__key); }
  static importJSON(serializedNode: SerializedExternalEmbedNode): ExternalEmbedNode { return $createExternalEmbedNode({ externalReferenceId: serializedNode.externalReferenceId, externalUrl: serializedNode.externalUrl }); }
  // Keep the Phase 3 type name on disk so existing Notes documents deserialize
  // without a migration. The implementation is provider-neutral; only the
  // provider payload selects the renderer.
  exportJSON(): SerializedExternalEmbedNode { return { ...super.exportJSON(), type: 'figma-embed', version: 1, provider: 'figma', externalReferenceId: this.__externalReferenceId, externalUrl: this.__externalUrl }; }
  static importDOM(): DOMConversionMap | null { return { div: (domNode: Node) => { const element = domNode as HTMLElement; if (element.getAttribute('data-external-embed') !== 'figma') return null; return { conversion: () => ({ node: $createExternalEmbedNode({ externalReferenceId: element.getAttribute('data-external-reference-id') || '', externalUrl: element.getAttribute('data-external-url') || '' }) }), priority: 4 }; } }; }
  exportDOM(): DOMExportOutput { const element = document.createElement('div'); element.setAttribute('data-external-embed', 'figma'); element.setAttribute('data-external-reference-id', this.__externalReferenceId); element.setAttribute('data-external-url', this.__externalUrl); return { element }; }
  constructor(externalReferenceId: string, externalUrl: string, key?: NodeKey) { super(key); this.__externalReferenceId = externalReferenceId; this.__externalUrl = externalUrl; }
  getExternalReferenceId(): string { return this.__externalReferenceId; }
  createDOM(): HTMLElement { const element = document.createElement('div'); element.contentEditable = 'false'; element.className = 'external-embed-block'; return element; }
  updateDOM(): false { return false; }
  decorate(): React.ReactNode { return <ExternalEmbedRenderer nodeKey={this.getKey()} externalReferenceId={this.__externalReferenceId} externalUrl={this.__externalUrl} />; }
}
export const $createExternalEmbedNode = ({ externalReferenceId, externalUrl, key }: { externalReferenceId: string; externalUrl: string; key?: NodeKey }) => $applyNodeReplacement(new ExternalEmbedNode(externalReferenceId, externalUrl, key));
export const $isExternalEmbedNode = (node: LexicalNode | null | undefined): node is ExternalEmbedNode => node instanceof ExternalEmbedNode;

// Backward-compatible aliases keep Phase 3 Notes documents and imports valid.
export const FigmaEmbedProvider = ExternalEmbedProvider;
export const FigmaEmbedNode = ExternalEmbedNode;
export const $createFigmaEmbedNode = $createExternalEmbedNode;
export const $isFigmaEmbedNode = $isExternalEmbedNode;
export type SerializedFigmaEmbedNode = SerializedExternalEmbedNode;
