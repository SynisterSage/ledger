import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Funnel, MoreHorizontal } from 'lucide-react';
import { ModuleHeaderStripAction, ModuleWindowHeader } from './ModuleWindowHeader';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { useSidebar } from '../../context/SidebarContext';
import type { AskLedgerSession } from './AskLedgerPanel';
import { WebSearchNewTab } from './WebSearchNewTab';
import { usePlatform } from '../../platform';
const DesktopAskLedgerPanel = lazy(() => import('./AskLedgerPanel').then((module) => ({ default: module.AskLedgerPanel })));
import { decodeAskLedgerContext, readPendingAskLedgerContext } from './askLedgerContext';
import type { AskLedgerInitialContext } from '../../types/askLedgerContext';

const recentSessionDate = (value: string) => {
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDelta = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (dayDelta === 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const sessionAge = (value: string) => {
  const age = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

export const NewTabWindow = (props: { onClose: () => void; isBrowser?: boolean }) => {
  const platform = usePlatform();
  if (platform.kind === 'web') return <WebSearchNewTab onClose={props.onClose} />;
  return <DesktopNewTabWindow {...props} />;
};

const DesktopNewTabWindow = ({ onClose, isBrowser = false }: { onClose: () => void; isBrowser?: boolean }) => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const { workspaceShellLayout } = useSidebar();
  const api = useApi();
  const isWindows = window.desktopWindow?.platform === 'win32';
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [askConversationActive, setAskConversationActive] = useState(false);
  const [askResetKey, setAskResetKey] = useState(0);
  const [askSessionTitle, setAskSessionTitle] = useState('Ask Ledger');
  const [recentSessions, setRecentSessions] = useState<AskLedgerSession[]>([]);
  const [selectedAskSession, setSelectedAskSession] = useState<AskLedgerSession | null>(null);
  const [openSessionMenu, setOpenSessionMenu] = useState<string | null>(null);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const [askInitialContext, setAskInitialContext] = useState<AskLedgerInitialContext | null>(null);
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

  const loadRecentSessions = async () => {
    if (!activeWorkspaceId || !user) {
      setRecentSessions([]);
      return;
    }
    try {
      const payload = await api.getAskLedgerSessions(activeWorkspaceId, 5) as { sessions?: AskLedgerSession[] };
      setRecentSessions(Array.isArray(payload?.sessions) ? payload.sessions.slice(0, 5) : []);
    } catch {
      setRecentSessions([]);
    }
  };

  useEffect(() => {
    void loadRecentSessions();
  }, [activeWorkspaceId, user]);

  useEffect(() => {
    setSelectedAskSession(null);
    setAskInitialContext(null);
    setAskConversationActive(false);
    setAskSessionTitle('Ask Ledger');
    setOpenSessionMenu(null);
    setConversationMenuOpen(false);
    setAskResetKey((key) => key + 1);
  }, [activeWorkspaceId]);

  useEffect(() => {
    const applyContext = (context: AskLedgerInitialContext | null) => {
      if (!context) return;
      setSelectedAskSession(null);
      setAskInitialContext(context);
      setAskConversationActive(false);
      setAskSessionTitle('Ask Ledger');
      setAskResetKey((key) => key + 1);
    };
    const fromFocus = decodeAskLedgerContext(new URLSearchParams(window.location.search).get('focusContext'));
    applyContext(fromFocus ?? readPendingAskLedgerContext());
    const listener = (event: Event) => applyContext((event as CustomEvent<AskLedgerInitialContext>).detail ?? null);
    window.addEventListener('ledger:ask-ledger-context', listener);
    return () => window.removeEventListener('ledger:ask-ledger-context', listener);
  }, []);

  useEffect(() => {
    if (!conversationMenuOpen) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      if (conversationMenuRef.current && !conversationMenuRef.current.contains(event.target as Node)) setConversationMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConversationMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [conversationMenuOpen]);

  const openAskSession = async (session: AskLedgerSession) => {
    setOpenSessionMenu(null);
    let restoredSession = session;
    if (activeWorkspaceId) {
      try {
        const payload = await api.getAskLedgerSession(activeWorkspaceId, session.id) as { session?: AskLedgerSession };
        if (payload.session) restoredSession = payload.session;
      } catch {
        // Fall back to the already-loaded row so history remains usable during a transient API failure.
      }
    }
    setSelectedAskSession(restoredSession);
    setAskInitialContext(restoredSession.initialContext ?? null);
    setAskSessionTitle(restoredSession.title || 'Ask Ledger');
    setAskConversationActive(true);
  };

  const deleteAskSession = async (session: AskLedgerSession) => {
    if (!activeWorkspaceId) return;
    setOpenSessionMenu(null);
    try {
      await api.deleteAskLedgerSession(activeWorkspaceId, session.id);
      await window.askLedger?.removeAttachments({ conversationId: session.id, attachmentIds: [] });
      setRecentSessions((current) => current.filter((item) => item.id !== session.id));
    } catch {
      // Keep the row visible when the delete request fails.
    }
  };

  const startNewAskChat = () => {
    setConversationMenuOpen(false);
    setSelectedAskSession(null);
    setAskInitialContext(null);
    setAskConversationActive(false);
    setAskSessionTitle('Ask Ledger');
    setAskResetKey((key) => key + 1);
  };

  const sessionGroups = [
    { label: 'Today', sessions: recentSessions.filter((session) => recentSessionDate(session.updatedAt) === 'Today') },
    { label: 'Earlier', sessions: recentSessions.filter((session) => recentSessionDate(session.updatedAt) !== 'Today') },
  ].filter((group) => group.sessions.length > 0);

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
        <div className={`web-new-tab-body relative z-10 mx-auto flex w-full max-w-[700px] flex-col px-5 pb-16 sm:px-6 ${askConversationActive ? 'pt-5' : 'pt-[clamp(56px,10vh,112px)]'}`}>
          <div ref={conversationMenuRef} className="relative z-20 flex items-center border-b border-[color:var(--ledger-border-subtle)] pb-3">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={conversationMenuOpen}
              onClick={() => setConversationMenuOpen((open) => !open)}
              className="inline-flex max-w-full items-center gap-2 rounded-full bg-[var(--ledger-surface-hover)] px-4 py-2 text-[15px] font-medium text-[var(--ledger-text-primary)] transition hover:bg-[var(--ledger-surface-card)] focus:outline-none focus:ring-2 focus:ring-[color:var(--ledger-border-subtle)]"
            >
              <span className="truncate">{askConversationActive ? askSessionTitle : 'New chat'}</span>
              <ChevronDown size={16} className={`shrink-0 text-[var(--ledger-text-muted)] transition-transform ${conversationMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {conversationMenuOpen && (
              <div role="menu" aria-label="Ask Ledger conversations" className="absolute left-0 top-12 w-[min(360px,calc(100vw-40px))] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 shadow-[var(--ledger-shadow)]">
                <button type="button" role="menuitem" onClick={startNewAskChat} className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--ledger-text-primary)] transition hover:bg-[var(--ledger-surface-hover)]">
                  New chat
                </button>
                {sessionGroups.map((group) => (
                  <div key={group.label} className="mt-1 border-t border-[color:var(--ledger-border-subtle)] pt-1">
                    <p className="px-3 py-2 text-[11px] font-medium text-[var(--ledger-text-muted)]">{group.label}</p>
                    {group.sessions.map((session) => (
                      <div key={session.id} className="group relative flex items-center rounded-xl transition hover:bg-[var(--ledger-surface-hover)]">
                        <button type="button" role="menuitem" onClick={() => { setConversationMenuOpen(false); void openAskSession(session); }} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                          <span className="block truncate text-sm text-[var(--ledger-text-primary)]">{session.title || 'Ask Ledger conversation'}</span>
                          <span className="mt-0.5 block text-xs text-[var(--ledger-text-muted)]">{sessionAge(session.updatedAt)}</span>
                        </button>
                        <button type="button" aria-label={`More actions for ${session.title || 'conversation'}`} onClick={(event) => { event.stopPropagation(); setOpenSessionMenu((current) => current === session.id ? null : session.id); }} className="mr-1 rounded-md p-1.5 text-[var(--ledger-text-muted)] opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:bg-[var(--ledger-surface)] hover:text-[var(--ledger-text-primary)]"><MoreHorizontal size={15} /></button>
                        {openSessionMenu === session.id && <div className="absolute right-2 top-10 z-30 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] p-1 shadow-lg"><button type="button" onClick={() => void deleteAskSession(session)} className="rounded-md px-3 py-1.5 text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]">Delete conversation</button></div>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <Suspense fallback={<div className="min-h-[124px] rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)]" />}><DesktopAskLedgerPanel workspaceId={activeWorkspaceId} resetKey={askResetKey} initialSession={selectedAskSession} initialContext={askInitialContext} onConversationChange={setAskConversationActive} onSessionTitleChange={setAskSessionTitle} onSessionPersisted={() => void loadRecentSessions()} /></Suspense>
        </div>
      </main>
    </div>
  );
};
