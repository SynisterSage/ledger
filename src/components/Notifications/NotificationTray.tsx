import { useEffect, useRef } from 'react';
import { NotificationCenterWindow } from './NotificationCenterWindow';

export const NOTIFICATION_TRAY_TOGGLE_EVENT = 'ledger:toggle-notification-tray';

export const requestNotificationTrayToggle = () => {
  window.dispatchEvent(new CustomEvent(NOTIFICATION_TRAY_TOGGLE_EVENT));
};

type NotificationTrayProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const NotificationTray: React.FC<NotificationTrayProps> = ({ isOpen, onClose }) => {
  const trayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (trayRef.current && target && trayRef.current.contains(target)) return;
      if (target instanceof Element && target.closest('[data-notification-tray-toggle]')) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={trayRef}
      className="fixed right-3 top-11 z-[100] w-[min(440px,calc(100vw-24px))] min-w-[min(400px,calc(100vw-24px))] max-w-full"
      role="dialog"
      aria-label="Notifications"
    >
      <NotificationCenterWindow
        mode="tray"
        onRequestClose={onClose}
        onViewAll={() => {
          onClose();
          void window.desktopWindow?.openModule('notifications', { kind: 'notifications' });
        }}
      />
    </div>
  );
};
