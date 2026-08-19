import { type CSSProperties, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, ChevronDown, Funnel, MoreHorizontal } from 'lucide-react';
import { ModuleHeaderStripAction, ModuleWindowHeader } from './ModuleWindowHeader';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { useSidebar } from '../../context/SidebarContext';
import type { AskLedgerSession } from './AskLedgerPanel';
import { WebSearchNewTab } from './WebSearchNewTab';
import { usePlatform } from '../../platform';
import { sidebarTheme } from '../Sidebar/sidebarTheme';
const DesktopAskLedgerPanel = lazy(() => import('./AskLedgerPanel').then((module) => ({ default: module.AskLedgerPanel })));
import { decodeAskLedgerContext, readPendingAskLedgerContext } from './askLedgerContext';
import type { AskLedgerInitialContext } from '../../types/askLedgerContext';
import type { AskLedgerCustomSkill } from '../../types/askLedgerSkills';

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
  const conversationMenuButtonRef = useRef<HTMLButtonElement>(null);
  const conversationMenuPopupRef = useRef<HTMLDivElement>(null);
  const footerHistoryPositionRef = useRef(false);
  const [conversationMenuPosition, setConversationMenuPosition] = useState<CSSProperties | null>(null);
  const [askInitialContext, setAskInitialContext] = useState<AskLedgerInitialContext | null>(null);
  const [customSkills, setCustomSkills] = useState<AskLedgerCustomSkill[]>([]);
  const [skillEditor, setSkillEditor] = useState<{ skill?: AskLedgerCustomSkill } | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillInstructions, setSkillInstructions] = useState('');
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillDeleting, setSkillDeleting] = useState(false);
  const askRouteRestoreRef = useRef(0);

  const updateAskRoute = (focusContext: string | null, historyMode: 'push' | 'replace') => {
    void window.desktopWindow?.updateWorkspaceRoute?.({
      kind: 'new-tab',
      focusContext,
      historyMode,
    });
  };

  const restoreAskSession = async (sessionId: string) => {
    const restoreId = ++askRouteRestoreRef.current;
    if (!activeWorkspaceId) return;

    let session = recentSessions.find((item) => item.id === sessionId) ?? null;
    try {
      const payload = await api.getAskLedgerSession(activeWorkspaceId, sessionId) as { session?: AskLedgerSession };
      if (payload.session) session = payload.session;
    } catch {
      // A stale route should fall back to the empty state instead of leaving a broken loading view.
    }
    if (restoreId !== askRouteRestoreRef.current) return;
    if (!session) {
      setSelectedAskSession(null);
      setAskInitialContext(null);
      setAskConversationActive(false);
      setAskSessionTitle('Ask Ledger');
      setAskResetKey((key) => key + 1);
      return;
    }
    setSelectedAskSession(session);
    setAskInitialContext(session.initialContext ?? null);
    setAskSessionTitle(session.title || 'Ask Ledger');
    setAskConversationActive(true);
  };
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

  const loadCustomSkills = async () => {
    if (!activeWorkspaceId || !user) { setCustomSkills([]); return; }
    try {
      const payload = await api.getAskLedgerSkills(activeWorkspaceId) as { skills?: AskLedgerCustomSkill[] };
      setCustomSkills(Array.isArray(payload.skills) ? payload.skills : []);
    } catch { setCustomSkills([]); }
  };

  useEffect(() => { void loadCustomSkills(); }, [activeWorkspaceId, user]);

  useEffect(() => {
    const openEditor = () => { setSkillEditor({}); setSkillName(''); setSkillInstructions(''); };
    window.addEventListener('ledger:ask-ledger-create-skill', openEditor);
    return () => window.removeEventListener('ledger:ask-ledger-create-skill', openEditor);
  }, []);

  useEffect(() => {
    setSelectedAskSession(null);
    setAskInitialContext(null);
    setAskConversationActive(false);
    setAskSessionTitle('Ask Ledger');
    setOpenSessionMenu(null);
    setConversationMenuOpen(false);
    setAskResetKey((key) => key + 1);
    updateAskRoute('new-tab:browser', 'replace');
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
    const handleWorkspaceRouteChanged = (_event: unknown, route?: { kind?: string | null; focusContext?: string | null }) => {
      if (route?.kind !== 'new-tab') return;
      const focusContext = route.focusContext ?? null;
      if (focusContext?.startsWith('ask-session:')) {
        void restoreAskSession(focusContext.slice('ask-session:'.length));
        return;
      }
      const askContext = decodeAskLedgerContext(focusContext);
      if (askContext) {
        setSelectedAskSession(null);
        setAskInitialContext(askContext);
        setAskConversationActive(false);
        setAskSessionTitle('Ask Ledger');
        setAskResetKey((key) => key + 1);
        return;
      }
      askRouteRestoreRef.current += 1;
      setSelectedAskSession(null);
      setAskInitialContext(null);
      setAskConversationActive(false);
      setAskSessionTitle('Ask Ledger');
      setAskResetKey((key) => key + 1);
    };

    window.ledgerIpc?.events?.onWorkspaceRouteChanged(handleWorkspaceRouteChanged as any);
    const initialFocusContext = new URLSearchParams(window.location.search).get('focusContext');
    if (activeWorkspaceId && initialFocusContext && initialFocusContext.startsWith('ask-session:')) {
      void restoreAskSession(initialFocusContext.slice('ask-session:'.length));
    }
    return () => { window.ledgerIpc?.events?.offWorkspaceRouteChanged(handleWorkspaceRouteChanged as any); };
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    if (!conversationMenuOpen) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!conversationMenuRef.current?.contains(target) && !conversationMenuPopupRef.current?.contains(target)) setConversationMenuOpen(false);
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

  useEffect(() => {
    const openFooterHistory = (event: Event) => {
      const detail = (event as CustomEvent<{ x?: number; y?: number }>).detail;
      const x = Number(detail?.x ?? window.innerWidth - 40);
      const y = Number(detail?.y ?? window.innerHeight - 8);
      setConversationMenuPosition({
        position: 'fixed',
        left: Math.max(8, Math.min(x - 224, window.innerWidth - 232)),
        top: Math.max(8, y),
        width: 224,
        zIndex: 9999,
        transform: 'translateY(calc(-100% - 8px))',
      });
      footerHistoryPositionRef.current = true;
      setConversationMenuOpen(true);
    };

    window.addEventListener('ledger:ask-ledger-history-open', openFooterHistory);
    return () => window.removeEventListener('ledger:ask-ledger-history-open', openFooterHistory);
  }, []);

  useLayoutEffect(() => {
    if (!conversationMenuOpen) return undefined;
    if (footerHistoryPositionRef.current) {
      footerHistoryPositionRef.current = false;
      return undefined;
    }
    const updatePosition = () => {
      const button = conversationMenuButtonRef.current;
      if (!button) return;
      const bounds = button.getBoundingClientRect();
      setConversationMenuPosition({
        position: 'fixed',
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - 232)),
        top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 320)),
        width: 224,
        zIndex: 9999,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
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
    updateAskRoute(`ask-session:${restoredSession.id}`, 'push');
  };

  const deleteAskSession = async (session: AskLedgerSession) => {
    if (!activeWorkspaceId) return;
    setOpenSessionMenu(null);
    const routeSessionId = new URLSearchParams(window.location.search).get('focusContext')?.startsWith('ask-session:')
      ? new URLSearchParams(window.location.search).get('focusContext')?.slice('ask-session:'.length)
      : null;
    const deletingActiveSession = selectedAskSession?.id === session.id || routeSessionId === session.id;
    try {
      await api.deleteAskLedgerSession(activeWorkspaceId, session.id);
      await window.askLedger?.removeAttachments({ conversationId: session.id, attachmentIds: [] });
      setRecentSessions((current) => current.filter((item) => item.id !== session.id));
      if (deletingActiveSession) {
        // Prevent a pending route restore from putting the deleted session
        // back on screen after we have moved to a fresh conversation.
        askRouteRestoreRef.current += 1;
        startNewAskChat('replace');
      }
    } catch {
      // Keep the row visible when the delete request fails.
    }
  };

  const startNewAskChat = (historyMode: 'push' | 'replace' = 'push') => {
    setConversationMenuOpen(false);
    setSelectedAskSession(null);
    setAskInitialContext(null);
    setAskConversationActive(false);
    setAskSessionTitle('Ask Ledger');
    setAskResetKey((key) => key + 1);
    updateAskRoute('new-tab:browser', historyMode);
  };

  const sessionGroups = [
    { label: 'Today', sessions: recentSessions.filter((session) => recentSessionDate(session.updatedAt) === 'Today') },
    { label: 'Earlier', sessions: recentSessions.filter((session) => recentSessionDate(session.updatedAt) !== 'Today') },
  ].filter((group) => group.sessions.length > 0);

  const editCustomSkill = (skill: AskLedgerCustomSkill) => { setSkillEditor({ skill }); setSkillName(skill.name); setSkillInstructions(skill.instructions); };
  const deleteCustomSkill = async (skill: AskLedgerCustomSkill) => {
    if (!activeWorkspaceId) return false;
    try {
      await api.deleteAskLedgerSkill(activeWorkspaceId, skill.id);
      setCustomSkills((current) => current.filter((item) => item.id !== skill.id));
      return true;
    } catch {
      // Keep the skill visible when the delete request fails.
      return false;
    }
  };
  const deleteEditedSkill = async () => {
    const skill = skillEditor?.skill;
    if (!skill || skillDeleting || !window.confirm(`Delete ${skill.name}?`)) return;
    setSkillDeleting(true);
    try {
      if (await deleteCustomSkill(skill)) setSkillEditor(null);
    } finally {
      setSkillDeleting(false);
    }
  };
  const saveCustomSkill = async () => {
    if (!activeWorkspaceId || !skillName.trim() || !skillInstructions.trim() || skillSaving) return;
    setSkillSaving(true);
    try {
      if (skillEditor?.skill) await api.updateAskLedgerSkill(activeWorkspaceId, skillEditor.skill.id, { name: skillName.trim(), instructions: skillInstructions.trim() });
      else await api.createAskLedgerSkill(activeWorkspaceId, { name: skillName.trim(), instructions: skillInstructions.trim() });
      await loadCustomSkills();
      setSkillEditor(null);
    } finally { setSkillSaving(false); }
  };

  if (skillEditor) return <div className={`relative flex h-screen min-h-0 flex-col overflow-hidden rounded-[var(--ledger-window-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] ${isBrowser ? 'web-new-tab-module' : ''}`} style={workspaceShellLayout.workspaceShellStyle}>
    <ModuleWindowHeader title="Ledger" stripTitle="New Tab" icon={<img src={`${import.meta.env.BASE_URL}logo-color.svg`} alt="" className="h-5 w-5" />} onClose={onClose} showBodyHeader={false} showWorkspaceNavigation />
    <main className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-20 pt-8 sm:px-10">
      <button type="button" onClick={() => setSkillEditor(null)} className="mb-16 inline-flex w-fit items-center gap-2 text-sm text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">← <span>Skill personalization</span></button>
      <div className="mx-auto w-full max-w-[720px]">
        <input autoFocus value={skillName} onChange={(event) => setSkillName(event.target.value)} placeholder="Skill name" aria-label="Skill name" className="mb-10 w-full bg-transparent text-4xl font-semibold tracking-[-0.04em] text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-placeholder)]" />
        <textarea value={skillInstructions} onChange={(event) => setSkillInstructions(event.target.value)} placeholder="Add instructions…" aria-label="Skill instructions" className="min-h-[380px] w-full resize-none rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] p-6 text-base leading-7 text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)]" />
        <div className="mt-8 flex items-center justify-between gap-2"><div>{skillEditor.skill && <button type="button" onClick={() => void deleteEditedSkill()} disabled={skillDeleting || skillSaving} className="rounded-lg px-4 py-2 text-sm text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)] disabled:opacity-40">{skillDeleting ? 'Deleting…' : 'Delete skill'}</button>}</div><div className="flex gap-2"><button type="button" onClick={() => setSkillEditor(null)} className="rounded-lg px-4 py-2 text-sm text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" disabled={!skillName.trim() || !skillInstructions.trim() || skillSaving || skillDeleting} onClick={() => void saveCustomSkill()} className="rounded-lg bg-[var(--ledger-text-primary)] px-4 py-2 text-sm text-[var(--ledger-background)] disabled:opacity-40">{skillEditor.skill ? 'Save' : 'Create'}</button></div></div>
      </div>
    </main>
  </div>;

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
        stripTitleAction={
          <div
            ref={conversationMenuRef}
            className="relative min-w-0"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
            <button
              ref={conversationMenuButtonRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={conversationMenuOpen}
              onClick={() => setConversationMenuOpen((open) => !open)}
              className={`inline-flex h-7 min-w-0 max-w-60 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20 ${conversationMenuOpen ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]' : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'}`}
            >
              <span className="truncate">{askConversationActive ? askSessionTitle : 'New chat'}</span>
              <ChevronDown size={14} className={`shrink-0 text-[var(--ledger-text-muted)] transition-transform ${conversationMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {conversationMenuOpen && createPortal(
              <div
                className="fixed inset-0 z-[9998] pointer-events-auto"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setConversationMenuOpen(false);
                }}
              >
              <div ref={conversationMenuPopupRef} role="menu" aria-label="Ask Ledger conversations" style={conversationMenuPosition ?? undefined} className={`ask-ledger-history-menu ${sidebarTheme.menu} max-h-[calc(100vh-16px)] overflow-x-hidden overflow-y-auto p-1.5`} onMouseDown={(event) => event.stopPropagation()}>
                <button type="button" role="menuitem" onClick={() => startNewAskChat()} className={sidebarTheme.menuItem}>
                  New chat
                </button>
                {sessionGroups.map((group) => (
                  <div key={group.label} className="mt-1 border-t border-[color:var(--ledger-border-subtle)] pt-1">
                    <p className="px-3 py-2 text-[11px] font-medium text-[var(--ledger-text-muted)]">{group.label}</p>
                    {group.sessions.map((session) => (
                      <div key={session.id} className="group relative flex items-center rounded-lg transition hover:bg-[var(--ledger-surface-hover)]">
                        <button type="button" role="menuitem" onClick={() => { setConversationMenuOpen(false); void openAskSession(session); }} className={`${sidebarTheme.menuItem} min-w-0 flex-1`}>
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
              </div>,
              document.body
            )}
          </div>
        }
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
        <div className={`web-new-tab-body relative z-10 mx-auto flex min-h-full w-full max-w-[700px] flex-col px-5 pb-16 sm:px-6 ${askConversationActive ? 'pt-5' : 'justify-center'}`}>
          <Suspense fallback={<div className="min-h-[124px] rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)]" />}><DesktopAskLedgerPanel workspaceId={activeWorkspaceId} resetKey={askResetKey} initialSession={selectedAskSession} initialContext={askInitialContext} customSkills={customSkills} onEditCustomSkill={editCustomSkill} onConversationChange={setAskConversationActive} onSessionTitleChange={setAskSessionTitle} onSessionPersisted={() => void loadRecentSessions()} /></Suspense>
        </div>
      </main>
    </div>
  );
};
