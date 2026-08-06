import React, { useEffect, useRef, useState } from 'react';
import Cropper, { type Area, type Point } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { Loader2, Minus, Plus } from 'lucide-react';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { UserAvatar } from '../Common/UserAvatar';
import { useUserAvatarUrl } from '../../hooks/useUserAvatarUrl';
import { loadAvatarImage, validateAvatarSource, normalizeAvatar } from '../../services/avatarProcessing';
import type { UserProfile } from '../../types/userProfile';

type AvatarEditorModalProps = {
  isOpen: boolean;
  user: UserProfile;
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void>;
  onRemove: () => Promise<void>;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
};

const focusableSelector = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const AvatarEditorModal = ({ isOpen, user, onClose, onSave, onRemove, returnFocusRef }: AvatarEditorModalProps) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const resolvedAvatarUrl = useUserAvatarUrl(user);

  const currentPreview = imageSrc || resolvedAvatarUrl;
  const hasAvatar = Boolean(user.avatarUrl);

  useEffect(() => {
    if (!isOpen) return;
    setImageSrc(null);
    setSelectedFile(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setError(null);
    setStatus(null);
    setBusy(null);
    setConfirmRemove(false);
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => () => {
    if (imageSrc) URL.revokeObjectURL(imageSrc);
  }, [imageSrc]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, isOpen, onClose]);

  const close = () => {
    if (busy) return;
    if (imageSrc) {
      URL.revokeObjectURL(imageSrc);
      setImageSrc(null);
    }
    onClose();
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setStatus(null);
    const validationError = validateAvatarSource(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      const nextImage = await loadAvatarImage(file);
      if (imageSrc) URL.revokeObjectURL(imageSrc);
      setSelectedFile(file);
      setImageSrc(nextImage);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'This image could not be read.');
    }
  };

  const save = async () => {
    if (!imageSrc || !selectedFile || !croppedAreaPixels || busy) return;
    setBusy('save');
    setError(null);
    setStatus(null);
    try {
      const normalized = await normalizeAvatar(selectedFile, croppedAreaPixels);
      await onSave(normalized.blob);
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your profile photo.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy('remove');
    setError(null);
    try {
      await onRemove();
      close();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove your profile photo.');
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={close}
      closeOnBackdropClick={!busy}
      backdropBorderRadius="inherit"
      disablePortal
      manageWindowChrome={false}
      classNameContainer="w-full max-w-md overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="avatar-editor-title">
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <div>
            <h2 id="avatar-editor-title" className="text-base font-semibold text-[var(--ledger-text-primary)]">Profile photo</h2>
            <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Choose a square image for your Ledger profile.</p>
          </div>
          <ModalCloseButton onClick={close} ariaLabel="Close profile photo editor" disabled={Boolean(busy)} />
        </div>

        <div className="space-y-4 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div className="relative mx-auto h-64 w-full max-w-64 overflow-hidden rounded-xl bg-[var(--ledger-surface-muted)]" aria-label="Profile photo crop preview">
            {currentPreview ? (
              <Cropper
                image={currentPreview}
                crop={crop}
                zoom={zoom}
                aspect={1}
                minZoom={1}
                maxZoom={3}
                cropShape="round"
                objectFit="cover"
                showGrid
                restrictPosition
                zoomWithScroll
                keyboardStep={4}
                roundCropAreaPixels
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
                mediaProps={{ alt: 'Profile photo preview' }}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <UserAvatar user={user} size="xl" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="sr-only" aria-label="Choose profile photo" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(busy)} className="h-9 rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50">
              {selectedFile ? 'Choose another photo' : hasAvatar ? 'Change photo' : 'Choose photo'}
            </button>
            {hasAvatar ? <span className="text-xs text-[var(--ledger-text-muted)]">Drag to reposition</span> : null}
          </div>

          {currentPreview ? (
            <label className="block text-xs text-[var(--ledger-text-muted)]" htmlFor="avatar-zoom">
              <span className="mb-1.5 flex items-center justify-between"><span>Zoom</span><span>{zoom.toFixed(1)}×</span></span>
              <span className="flex items-center gap-2"><Minus size={13} aria-hidden="true" /><input id="avatar-zoom" type="range" min="1" max="3" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} disabled={Boolean(busy)} className="w-full accent-[var(--ledger-accent)]" aria-label="Profile photo zoom" aria-valuetext={`${zoom.toFixed(1)} times`} /><Plus size={13} aria-hidden="true" /></span>
            </label>
          ) : null}

          {error ? <p className="text-xs text-[var(--ledger-danger)]" role="alert">{error}</p> : null}
          {status ? <p className="text-xs text-[var(--ledger-text-muted)]" role="status">{status}</p> : null}
          {confirmRemove ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2.5">
              <p className="text-xs text-[var(--ledger-text-secondary)]">Remove your profile photo?</p>
              <div className="flex shrink-0 gap-2"><button type="button" onClick={() => setConfirmRemove(false)} disabled={Boolean(busy)} className="text-xs text-[var(--ledger-text-muted)]">Keep</button><button type="button" onClick={() => void remove()} disabled={Boolean(busy)} className="text-xs font-medium text-[var(--ledger-danger)]">Remove</button></div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div>{hasAvatar && !confirmRemove ? <button type="button" onClick={() => setConfirmRemove(true)} disabled={Boolean(busy)} className="text-xs font-medium text-[var(--ledger-danger)] disabled:opacity-50">Remove photo</button> : null}</div>
          <div className="flex items-center gap-2"><button type="button" onClick={close} disabled={Boolean(busy)} className="h-9 rounded-full px-3 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" onClick={() => void save()} disabled={!selectedFile || !croppedAreaPixels || Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ledger-accent)] px-4 text-xs font-medium text-white disabled:opacity-50">{busy === 'save' ? <><Loader2 size={13} className="animate-spin" />Saving…</> : 'Save'}</button></div>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default AvatarEditorModal;
