import { useEffect, useRef } from 'react';
import { NotificationCenterWindow } from './NotificationCenterWindow';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { usePlatform } from '../../platform';
import { useSidebar } from '../../context/SidebarContext';

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
  const platform = usePlatform();
  const { isVisible, position, state } = useSidebar();
  const { activeWorkspaceId } = useWorkspaceContext();

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (trayRef.current && target && trayRef.current.contains(target)) return;
      if (
        target instanceof Element &&
        (target.closest('[data-notification-tray-toggle]') || target.closest('[role="menu"]'))
      ) {
        return;
      }
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

  // The web shell reserves sidebar space in its flex layout, but this tray is
  // mounted outside that layout and is therefore viewport-fixed. Keep it in
  // the content area when a docked sidebar occupies the right or top edge.
  const webSidebarVisible = platform.kind === 'web' && isVisible && state !== 'fullscreen';
  const webSidebarWidth = state === 'expanded' ? 'var(--web-sidebar-width)' : 'var(--web-sidebar-collapsed-width)';
  const webTrayStyle = platform.kind === 'web'
    ? {
        right: position === 'right' && webSidebarVisible
          ? `calc(${webSidebarWidth} + 12px)`
          : '12px',
        top: position === 'top' && webSidebarVisible
          ? `calc(${state === 'expanded' ? '144px' : '60px'} + 12px)`
          : '44px',
      }
    : undefined;

  return (
    <div
      ref={trayRef}
      className="fixed right-3 top-11 z-[100] w-[min(440px,calc(100vw-24px))] min-w-[min(400px,calc(100vw-24px))] max-w-full"
      style={webTrayStyle}
      role="dialog"
      aria-label="Notifications"
    >
      <NotificationCenterWindow
        mode="tray"
        onRequestClose={onClose}
        onViewAll={() => {
          onClose();
          if (platform.kind === 'web' && activeWorkspaceId) {
            platform.navigation.openRoute({
              kind: 'workspace',
              workspaceId: activeWorkspaceId,
              page: 'notifications',
            });
            return;
          }
          void window.desktopWindow?.openModule('notifications', { kind: 'notifications' });
        }}
      />
    </div>
  );
};
