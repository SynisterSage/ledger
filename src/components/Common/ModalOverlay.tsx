import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ModalOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  classNameBackdrop?: string;
  classNameContainer?: string;
  closeOnBackdropClick?: boolean;
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
    borderRadius: 'var(--modal-backdrop-radius, 28px)',
    overflow: 'hidden',
    // Expand slightly to cover 1px window borders/antialiasing artifacts.
    position: 'fixed',
    top: 'calc(-1px)',
    left: 'calc(-1px)',
    right: 'calc(-1px)',
    bottom: 'calc(-1px)',
    // Ensure overlay sits above shadows and outlines
    boxShadow: 'none',
  };

  useEffect(() => {
    document.body.classList.add('has-modal-open');
    // Hide native window shadow while modal is open to avoid corner artifacts
    void (async () => {
      try {
        await (window as any).desktopWindow?.setHasShadow?.(false);
      } catch {}
    })();

    return () => {
      document.body.classList.remove('has-modal-open');
      void (async () => {
        try {
          await (window as any).desktopWindow?.setHasShadow?.(true);
        } catch {}
      })();
    };
  }, []);

  return createPortal(
    <div
      className={`fixed inset-0 z-9999 isolate ${classNameBackdrop}`}
      style={wrapperStyle}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(17,24,39,0.45)' }}
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
    </div>,
    document.body
  );
};
