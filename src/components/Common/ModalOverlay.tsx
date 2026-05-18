import { ReactNode } from 'react';
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

  return createPortal(
    <div
      className={`fixed inset-0 z-9999 flex items-center justify-center bg-black/35 p-4 ${classNameBackdrop}`}
      onClick={handleBackdropClick}
    >
      <div
        className={classNameContainer}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};
