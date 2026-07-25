import { Link2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';

declare global {
  interface Window { google?: any; gapi?: any; }
}

const loadPicker = () => new Promise<void>((resolve, reject) => {
  if (window.google?.picker) return resolve();
  const existing = document.querySelector('script[data-ledger-google-picker]');
  if (existing) { existing.addEventListener('load', () => window.gapi.load('picker', resolve)); existing.addEventListener('error', () => reject(new Error('Google Picker could not load.'))); return; }
  const script = document.createElement('script'); script.src = 'https://apis.google.com/js/api.js'; script.async = true; script.dataset.ledgerGooglePicker = 'true'; script.onload = () => window.gapi.load('picker', resolve); script.onerror = () => reject(new Error('Google Picker could not load.')); document.head.appendChild(script);
});

export function GoogleDriveIntakeCaptureButton({ onCaptured }: { onCaptured?: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const capture = async (fileIds: string[]) => {
    const result = await api.captureGoogleDriveFiles({ file_ids: fileIds, capture_method: 'picker' }) as { captured?: unknown[]; duplicates?: unknown[]; failures?: Array<{ error?: string }> };
    const captured = result.captured?.length || 0;
    const duplicates = result.duplicates?.length || 0;
    const failures = result.failures?.length || 0;
    toast.show(`${captured} file${captured === 1 ? '' : 's'} added to Intake${duplicates ? ` · ${duplicates} already there` : ''}${failures ? ` · ${failures} failed` : ''}.`, { variant: failures ? 'error' : 'success' });
    onCaptured?.();
  };

  const openPicker = async () => {
    setBusy(true);
    try {
      const token = await api.getGoogleDrivePickerToken() as { access_token?: string };
      if (!token.access_token) throw new Error('Reconnect Google Drive to continue.');
      await loadPicker();
      await new Promise<void>((resolve, reject) => {
        const picker = new window.google.picker.PickerBuilder()
          .addView(window.google.picker.ViewId.DOCS)
          .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
          .setOAuthToken(token.access_token)
          .setCallback(async (data: any) => {
            if (data.action === window.google.picker.Action.PICKED) {
              try { await capture((data.docs || []).map((doc: any) => String(doc.id)).filter(Boolean)); resolve(); } catch (error) { reject(error); }
            } else if (data.action === window.google.picker.Action.CANCEL) resolve();
          }).build();
        picker.setVisible(true);
      });
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not add Google Drive files.', { variant: 'error' }); }
    finally { setBusy(false); }
  };

  const pasteLink = async () => {
    const url = window.prompt('Paste a Google Drive link');
    if (!url?.trim()) return;
    setBusy(true);
    try { await api.resolveGoogleDriveIntakeUrl(url.trim()); toast.show('Google Drive file added to Intake.', { variant: 'success' }); onCaptured?.(); }
    catch (error) { toast.show(error instanceof Error ? error.message : 'Could not add this Google Drive file.', { variant: 'error' }); }
    finally { setBusy(false); }
  };

  return <div className="flex items-center gap-1.5"><button type="button" onClick={() => void pasteLink()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--ledger-border-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><Link2 size={13} />Paste Drive link</button><button type="button" onClick={() => void openPicker()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ledger-accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : null}{busy ? 'Opening…' : 'Google Drive'}</button></div>;
}
