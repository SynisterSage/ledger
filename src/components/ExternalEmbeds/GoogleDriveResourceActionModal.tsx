import { useState } from 'react';
import { ModalOverlay } from '../Common/ModalOverlay';

export type GoogleDriveAction = 'rename' | 'copy' | 'move';

export function GoogleDriveResourceActionModal({ action, title, currentParentId, onClose, onSubmit }: { action: GoogleDriveAction; title: string; currentParentId?: string; onClose: () => void; onSubmit: (payload: { name?: string; destination_folder_id?: string; expected_current_parent_id?: string }) => Promise<void> }) {
  const [name, setName] = useState(action === 'rename' ? title : `${title} copy`);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { await onSubmit({ ...(action !== 'move' ? { name: name.trim() } : {}), ...(action !== 'rename' ? { destination_folder_id: destination.trim() } : {}), ...(action === 'move' && currentParentId ? { expected_current_parent_id: currentParentId } : {}) }); onClose(); } finally { setBusy(false); } };
  const heading = action === 'rename' ? 'Rename Drive item' : action === 'copy' ? 'Copy Drive file' : 'Move Drive item';
  return <ModalOverlay isOpen onClose={onClose} classNameContainer="w-full max-w-md p-5"><h2 className="text-base font-semibold text-[var(--ledger-text-primary)]">{heading}</h2><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">{title}</p>
    {action !== 'move' && <label className="mt-4 block text-xs font-medium">Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-transparent px-2.5 py-2 text-sm" /></label>}
    {action !== 'rename' && <label className="mt-4 block text-xs font-medium">Destination folder ID<input autoFocus={action === 'move'} value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Choose an approved Drive folder" className="mt-1 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-transparent px-2.5 py-2 text-sm" /></label>}
    <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-[var(--ledger-text-muted)]">Cancel</button><button type="button" disabled={busy || (action !== 'rename' && !destination.trim()) || (action === 'rename' && !name.trim())} onClick={() => void submit()} className="rounded-md bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? 'Working…' : 'Continue'}</button></div>
  </ModalOverlay>;
}
