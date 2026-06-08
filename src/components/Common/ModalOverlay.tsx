import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

let openModalCount = 0;

const setModalWindowChrome = (isOpen: boolean) => {
  if (typeof document === 'undefined') return;
  if (isOpen) {
    document.body.classList.add('has-modal-open');
  } else {
    document.body.classList.remove('has-modal-open');
  }

  void (async () => {
    try {
      await (window as any).desktopWindow?.setHasShadow?.(!isOpen);
    } catch {
      // Ignore desktop-window chrome failures in web/test environments.
    }
  })();
};

export interface ModalOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  classNameBackdrop?: string;
  classNameContainer?: string;
  closeOnBackdropClick?: boolean;
  backdropBorderRadius?: string;
  manageWindowChrome?: boolean;
  disablePortal?: boolean;
}

/**
 * Shared modal overlay component.
 * Ensures consistent z-index, proper backdrop positioning, and portal rendering.
 * Always renders to document.body to avoid clipping by app shell borders.
 */
export const ModalOverlay = ({
  isOpen,
  onClose,
  children,
  classNameBackdrop = '',
  classNameContainer = '',
  closeOnBackdropClick = true,
  backdropBorderRadius = 'var(--modal-backdrop-radius, 28px)',
  manageWindowChrome = true,
  disablePortal = false,
}: ModalOverlayProps) => {
  if (!isOpen) return null;
  const handleBackdropClick = (event: React.MouseEvent) => {
    if (closeOnBackdropClick && event.target === event.currentTarget) {
      onClose();
    }
  };

  // Use CSS variables so the backdrop radius matches the app/window radius.
  // The outer wrapper clips the absolute backdrop so corners are clean inside rounded windows.
  const wrapperStyle: React.CSSProperties = {
    borderRadius: backdropBorderRadius,
    overflow: 'hidden',
    position: disablePortal ? 'absolute' : 'fixed',
    top: disablePortal ? 'calc(-1px)' : 'calc(-1px)',
    left: disablePortal ? 'calc(-1px)' : 'calc(-1px)',
    right: disablePortal ? 'calc(-1px)' : 'calc(-1px)',
    bottom: disablePortal ? 'calc(-1px)' : 'calc(-1px)',
    // Ensure overlay sits above shadows and outlines
    boxShadow: 'none',
  };

  useEffect(() => {
    if (!manageWindowChrome) return;
    openModalCount += 1;
    if (openModalCount === 1) {
      setModalWindowChrome(true);
    }

    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        setModalWindowChrome(false);
      }
    };
  }, [manageWindowChrome]);

  const overlay = (
    <div
      className={`fixed inset-0 z-[9999] isolate ${classNameBackdrop}`}
      style={wrapperStyle}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--ledger-backdrop, rgba(17,24,39,0.45))' }}
        onClick={handleBackdropClick}
      />
      <div
        className="relative z-10 flex h-full w-full items-center justify-center p-4"
        onClick={handleBackdropClick}
      >
        <div
          className={classNameContainer}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="max-h-[calc(100vh-4rem)] overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  return disablePortal ? overlay : createPortal(overlay, document.body);
};
