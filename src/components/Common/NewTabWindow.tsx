import { useEffect, useState } from 'react';
import { Bell, Funnel } from 'lucide-react';
import { ModuleHeaderStripAction, ModuleWindowHeader } from './ModuleWindowHeader';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { useSidebar } from '../../context/SidebarContext';
import { AskLedgerPanel } from './AskLedgerPanel';

export const NewTabWindow = ({ onClose, isBrowser = false }: { onClose: () => void; isBrowser?: boolean }) => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const { workspaceShellLayout } = useSidebar();
  const api = useApi();
  const isWindows = window.desktopWindow?.platform === 'win32';
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  useEffect(() => {
    if (!user || !activeWorkspaceId) {
      setInboxCount(0);
      setNotificationCount(0);
      return;
    }

    let cancelled = false;
    const loadCounts = async () => {
      try {
        const [inbox, notifications] = await Promise.all([
          api.getInboxCount() as Promise<{ count?: number }>,
          api.getNotificationCenterSummary() as Promise<{ counts?: { unread?: number } }>,
        ]);
        if (cancelled) return;
        setInboxCount(Math.max(0, Number(inbox?.count ?? 0)));
        setNotificationCount(Math.max(0, Number(notifications?.counts?.unread ?? 0)));
      } catch {
        if (!cancelled) {
          setInboxCount(0);
          setNotificationCount(0);
        }
      }
    };

    void loadCounts();
    const timer = window.setInterval(() => void loadCounts(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWorkspaceId, api, user]);

  return (
    <div
      className={`relative flex h-screen min-h-0 flex-col overflow-hidden rounded-[var(--ledger-window-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none ${isBrowser ? 'web-new-tab-module' : ''}`}
      style={{ scrollbarGutter: 'auto', ...workspaceShellLayout.workspaceShellStyle }}
    >
      <ModuleWindowHeader
        title="Ledger"
        stripTitle="New Tab"
        icon={<img src={`${import.meta.env.BASE_URL}logo-color.svg`} alt="" className="h-5 w-5" />}
        onClose={onClose}
        minimizeLabel="Minimize New Tab"
        onMinimize={isBrowser ? undefined : () => void window.desktopWindow?.minimizeModule('new-tab')}
        fullscreenLabel="Fullscreen New Tab"
        onToggleFullscreen={isBrowser ? undefined : () => void window.desktopWindow?.toggleModuleFullscreen('new-tab')}
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Funnel size={12} />}
              count={inboxCount}
              webDestination="inbox"
              onClick={() => void window.desktopWindow?.openModule('inbox')}
              title="Open Intake"
              ariaLabel="Open Intake"
            />
            <ModuleHeaderStripAction
              icon={<Bell size={12} />}
              count={notificationCount}
              notificationTrayToggle
              onClick={() => window.dispatchEvent(new CustomEvent('ledger:toggle-notification-tray'))}
              title="Open notifications center"
              ariaLabel="Open notifications center"
            />
          </>
        }
        showBodyHeader={false}
        showWorkspaceNavigation
      />
      <main className="web-new-tab-content relative min-h-0 flex-1 overflow-auto bg-[var(--ledger-background)]">
        <div aria-hidden="true" className="pointer-events-none sticky top-0 z-0 h-0 overflow-visible">
          <div className="absolute left-0 top-0 h-screen w-full overflow-hidden">
            <div
              className="ledger-new-tab-atmosphere absolute inset-0"
              style={{
                background: [
                  ...(isWindows
                    ? [
                        'radial-gradient(ellipse 125% 56% at 50% 148%, var(--ledger-new-tab-atmosphere), transparent 100%)',
                        'linear-gradient(to top, var(--ledger-new-tab-atmosphere), transparent 88%)',
                      ]
                    : [
                        'radial-gradient(ellipse 68% 42% at 50% 145%, var(--ledger-new-tab-atmosphere), transparent 86%)',
                        'linear-gradient(to top, var(--ledger-new-tab-atmosphere), transparent 88%)',
                      ]),
                ].join(', '),
              }}
            />
          </div>
        </div>
        <div className="web-new-tab-body relative z-10 mx-auto flex w-full max-w-[680px] flex-col px-6 pb-16 pt-24">
          <img src={`${import.meta.env.BASE_URL}logo-color.svg`} alt="Ledger" className="mb-8 h-8 w-8" />
          <h1 className="text-[28px] font-regular tracking-[-0.03em] text-[var(--ledger-text-primary)]">Ask Ledger</h1>
          <p className="mt-2 text-sm text-[var(--ledger-text-muted)]">Ask questions about your workspace.</p>
          <AskLedgerPanel workspaceId={activeWorkspaceId} />

        </div>
      </main>
    </div>
  );
};
