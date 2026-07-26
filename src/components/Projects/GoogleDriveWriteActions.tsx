import { FileSpreadsheet, FileText, FolderPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';
import { GOOGLE_DRIVE_MAX_UPLOAD_BYTES, GOOGLE_DRIVE_MAX_UPLOAD_LABEL } from '../../config/googleDrive';
import { ExternalProviderOperationStatus, type ExternalProviderOperation } from './ExternalProviderOperationStatus';

type Source = { id: string; name: string; provider_source_id: string; external_metadata?: Record<string, unknown> };

export function GoogleDriveWriteActions({ projectId, canEdit, onComplete, onBeforeAction }: { projectId: string; canEdit: boolean; onComplete?: () => void | Promise<void>; onBeforeAction?: () => void | Promise<void> }) {
  const api = useApi();
  const toast = useToast();
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<ExternalProviderOperation | null>(null);

  useEffect(() => {
    void api.getProjectConnectedSources(projectId).then((result) => setSource((Array.isArray(result) ? result[0] : null) as Source | null)).catch(() => setSource(null));
  }, [api, projectId]);

  const create = async (kind: 'folder' | 'google_doc' | 'google_sheet' | 'google_slide') => {
    if (!source) { toast.show('Connect a Google Drive folder to this project first.', { variant: 'error' }); return; }
    await onBeforeAction?.();
    const name = window.prompt(kind === 'folder' ? 'Folder name' : 'File name');
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const result = kind === 'folder' ? await api.createGoogleDriveFolder({ name, destination_folder_id: source.provider_source_id, connected_source_id: source.id, entity_type: 'project', entity_id: projectId }) : await api.createGoogleDriveNativeFile({ name, file_type: kind, destination_folder_id: source.provider_source_id, connected_source_id: source.id, entity_type: 'project', entity_id: projectId });
      if ((result as any)?.operation) setOperation((result as any).operation as ExternalProviderOperation);
      toast.show(kind === 'folder' ? 'Google Drive folder created.' : 'Google Drive file created.', { variant: 'success' }); await onComplete?.();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not create the Google Drive item.', { variant: 'error' }); }
    finally { setBusy(false); }
  };

  const upload = async (file: File) => {
    if (!source) { toast.show('Connect a Google Drive folder to this project first.', { variant: 'error' }); return; }
    if (file.size > GOOGLE_DRIVE_MAX_UPLOAD_BYTES) { toast.show(`Uploads are limited to ${GOOGLE_DRIVE_MAX_UPLOAD_LABEL}. This file is too large for the current Drive upload path.`, { variant: 'error' }); return; }
    await onBeforeAction?.();
    setBusy(true);
    try {
      const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.onerror = () => reject(new Error('Could not read this file.')); reader.readAsDataURL(file); });
      const result = await api.uploadFileToGoogleDrive({ name: file.name, mime_type: file.type || 'application/octet-stream', content_base64: content, destination_folder_id: source.provider_source_id, connected_source_id: source.id, entity_type: 'project', entity_id: projectId });
      if ((result as any)?.operation) setOperation((result as any).operation as ExternalProviderOperation);
      toast.show('File uploaded to Google Drive.', { variant: 'success' }); await onComplete?.();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not upload this file.', { variant: 'error' }); }
    finally { setBusy(false); }
  };

  return <>{operation && <ExternalProviderOperationStatus operation={operation} />}<div className="flex flex-wrap items-center gap-1.5 border-b border-[color:var(--ledger-border-subtle)] pb-2"><span className="mr-1 text-[11px] text-[var(--ledger-text-muted)]">Create in Drive</span><label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"><input type="file" className="sr-only" disabled={!canEdit || busy} onClick={() => void onBeforeAction?.()} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ''; }} />Upload</label><button type="button" disabled={!canEdit || busy} onClick={() => void create('folder')} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><FolderPlus size={12} />Folder</button><button type="button" disabled={!canEdit || busy} onClick={() => void create('google_doc')} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><FileText size={12} />Doc</button><button type="button" disabled={!canEdit || busy} onClick={() => void create('google_sheet')} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><FileSpreadsheet size={12} />Sheet</button><button type="button" disabled={!canEdit || busy} onClick={() => void create('google_slide')} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><FileText size={12} />Slide</button></div></>;
}
