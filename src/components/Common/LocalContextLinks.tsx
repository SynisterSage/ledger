import { useEffect, useState } from 'react';
import { ExternalLink, FilePlus2, FolderOpen, Loader2, X } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import type { LocalContextFile, LocalContextTargetType } from '../../types/localContextLibrary';

export function LocalContextLinks({
  workspaceId,
  targetType,
  targetId,
  className = '',
}: {
  workspaceId: string;
  targetType: LocalContextTargetType;
  targetId: string;
  className?: string;
}) {
  const { user } = useAuthContext();
  const [files, setFiles] = useState<LocalContextFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!user?.id || !window.localContext) return;
    try {
      const result = await window.localContext.list({ ownerUserId: user.id, workspaceId });
      setFiles(result.files.filter((file) => file.links.some((link) => link.targetType === targetType && link.targetId === targetId)));
      setError(null);
    } catch {
      setError('Local files could not be loaded.');
    }
  };

  useEffect(() => {
    void load();
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; targetType?: string; targetId?: string }>).detail;
      if (detail?.workspaceId === workspaceId && detail.targetType === targetType && detail.targetId === targetId) {
        void load();
      }
    };
    window.addEventListener('ledger:local-context-changed', refresh);
    return () => window.removeEventListener('ledger:local-context-changed', refresh);
  }, [user?.id, workspaceId, targetType, targetId]);

  const importAndLink = async () => {
    if (!user?.id || !window.localContext || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.localContext.importFiles({ ownerUserId: user.id, workspaceId });
      if (!result.canceled) {
        for (const file of result.files) {
          await window.localContext.link({ ownerUserId: user.id, workspaceId, fileId: file.id, targetType, targetId });
        }
        await load();
      }
    } catch {
      setError('That file could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (file: LocalContextFile) => {
    if (!user?.id || !window.localContext || busy) return;
    setBusy(true);
    try {
      await window.localContext.unlink({ ownerUserId: user.id, workspaceId, fileId: file.id, targetType, targetId });
      await load();
    } catch {
      setError('The local file could not be unlinked.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4 ${className}`} aria-label="Local files">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-[var(--ledger-text-primary)]">On this device</p>
          <p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">Private files stay on this computer.</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void importAndLink()} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50" title="Add a local file">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <FilePlus2 size={12} />} Add file
          </button>
          <button type="button" onClick={() => void window.desktopWindow?.openModule('files', { kind: 'files' })} className="rounded-md p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]" title="Open Files & links" aria-label="Open Files & links"><FolderOpen size={13} /></button>
        </div>
      </div>
      {files.length ? <div className="space-y-1">{files.map((file) => <div key={file.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-[var(--ledger-surface-hover)]"><button type="button" onClick={() => void window.localContext?.open({ ownerUserId: user?.id ?? '', workspaceId, fileId: file.id })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[var(--ledger-text-secondary)]"><ExternalLink size={11} className="shrink-0 text-[var(--ledger-text-muted)]" /><span className="truncate">{file.name}</span></button><button type="button" onClick={() => void unlink(file)} disabled={busy} className="rounded p-0.5 text-[var(--ledger-text-muted)] hover:text-[var(--ledger-danger)] disabled:opacity-50" title={`Remove ${file.name}`} aria-label={`Remove ${file.name}`}><X size={12} /></button></div>)}</div> : <p className="rounded-md bg-[var(--ledger-surface)] px-2 py-2 text-[11px] text-[var(--ledger-text-muted)]">No local files linked yet.</p>}
      {error ? <p className="text-[11px] text-[var(--ledger-danger)]">{error}</p> : null}
    </section>
  );
}
