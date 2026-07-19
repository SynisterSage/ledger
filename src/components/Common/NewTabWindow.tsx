import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, FileText, FolderKanban, Funnel, Inbox, LayoutList, Pin, Search } from 'lucide-react';
import { ModuleHeaderStripAction, ModuleWindowHeader } from './ModuleWindowHeader';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { usePins } from '../../context/PinsContext';
import { getPinNavigationTarget } from '../../utils/pins';
import { useSidebar } from '../../context/SidebarContext';
import {
  searchCategoryLabels,
  searchIconMap,
  type SearchResult,
  useWorkspaceSearch,
} from '../Search/useWorkspaceSearch';

type RecentRoute = ModuleFocusPayload & { kind: ModuleWindowKind };

const getRecentRoutesStorageKey = (workspaceId: string) =>
  `ledger:new-tab-recent-routes:${workspaceId}`;

const normalizeRecentRoutes = (routes: unknown): RecentRoute[] => {
  if (!Array.isArray(routes)) return [];
  return routes.filter(
    (route): route is RecentRoute =>
      Boolean(route && typeof route === 'object' && 'kind' in route && route.kind !== 'new-tab')
  );
};

const visibleRecentRoutes = (routes: RecentRoute[]) => routes.slice(-3).reverse();

const destinations: Array<{
  label: string;
  kind: ModuleWindowKind;
  icon: typeof LayoutList;
}> = [
  { label: 'Overview', kind: 'dashboard', icon: LayoutList },
  { label: 'Projects', kind: 'projects', icon: FolderKanban },
  { label: 'Notes', kind: 'notes', icon: FileText },
  { label: 'Calendar', kind: 'calendar', icon: CalendarDays },
  { label: 'Intake', kind: 'inbox', icon: Inbox },
  { label: 'Notifications', kind: 'notifications', icon: Bell },
];

const routeLabel = (route: RecentRoute) => {
  if (route.kind === 'dashboard') return 'Overview';
  if (route.kind === 'projects') return route.focusProjectId ? 'Project' : 'Projects';
  if (route.kind === 'notes') return route.focusNoteId ? 'Note' : 'Notes';
  if (route.kind === 'inbox') return 'Intake';
  return route.kind[0].toUpperCase() + route.kind.slice(1);
};

export const NewTabWindow = ({ onClose }: { onClose: () => void }) => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const { workspaceShellLayout } = useSidebar();
  const api = useApi();
  const { pins } = usePins();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const quickNavRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [pinnedPersonNames, setPinnedPersonNames] = useState<Record<string, string>>({});
  const { results, isLoading, trimmedQuery } = useWorkspaceSearch(query);

  useEffect(() => {
    const personPins = pins.filter((pin) => pin.object_type === 'person');
    if (personPins.length === 0) {
      setPinnedPersonNames({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      personPins.map(async (pin) => {
        try {
          const payload = (await api.getPerson(pin.object_id)) as {
            person?: { name?: string | null };
          };
          const name = payload?.person?.name?.trim();
          return name ? [pin.object_id, name] as const : null;
        } catch {
          return null;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setPinnedPersonNames(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });

    return () => {
      cancelled = true;
    };
  }, [api, pins]);

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
          api.getNotificationCenterSummary() as Promise<{ counts?: { active?: number } }>,
        ]);
        if (cancelled) return;
        setInboxCount(Math.max(0, Number(inbox?.count ?? 0)));
        setNotificationCount(Math.max(0, Number(notifications?.counts?.active ?? 0)));
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

  useEffect(() => {
    if (!activeWorkspaceId) {
      setRecentRoutes([]);
      return;
    }

    const storageKey = getRecentRoutesStorageKey(activeWorkspaceId);
    let storedRoutes: RecentRoute[] = [];
    try {
      storedRoutes = normalizeRecentRoutes(JSON.parse(localStorage.getItem(storageKey) ?? '[]'));
      setRecentRoutes(visibleRecentRoutes(storedRoutes));
    } catch {
      setRecentRoutes([]);
    }

    let mounted = true;
    const applyRecentRoutes = (routes: unknown, preserveStoredWhenEmpty = false) => {
      const normalizedRoutes = normalizeRecentRoutes(routes);
      if (normalizedRoutes.length === 0 && preserveStoredWhenEmpty && storedRoutes.length > 0) {
        return;
      }

      const nextRoutes = visibleRecentRoutes(normalizedRoutes);
      if (!mounted) return;
      setRecentRoutes(nextRoutes);
      try {
        if (normalizedRoutes.length > 0) {
          localStorage.setItem(storageKey, JSON.stringify(nextRoutes));
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        // Ignore unavailable storage.
      }
    };

    inputRef.current?.focus();
    void window.desktopWindow?.getWorkspaceNavigationState?.().then((state) => {
      applyRecentRoutes(state?.recentRoutes, true);
    });

    const handleNavigationState = (_event: unknown, state?: { recentRoutes?: unknown[] }) => {
      applyRecentRoutes(state?.recentRoutes);
    };
    window.ipcRenderer?.on?.('workspace:navigation-state', handleNavigationState as any);

    return () => {
      mounted = false;
      window.ipcRenderer?.off?.('workspace:navigation-state', handleNavigationState as any);
    };
  }, [activeWorkspaceId]);

  const openDestination = (kind: ModuleWindowKind, route?: ModuleFocusPayload) => {
    void window.desktopWindow?.openModule(kind, { kind, ...(route ?? {}) });
  };

  const openPinnedItem = (pin: (typeof pins)[number]) => {
    const target = getPinNavigationTarget(pin);
    if (!target) return;
    void window.desktopWindow?.openModule(
      target.module as ModuleWindowKind,
      target.focus as ModuleFocusPayload
    );
  };

  const getPinnedLabel = (pin: (typeof pins)[number]) => {
    const resolvedName = pinnedPersonNames[pin.object_id];
    if (pin.object_type === 'person' && resolvedName) return resolvedName;
    if (pin.object_type !== 'person' || !pin.title.includes('@')) return pin.title;
    const context = pin.destination.focusContext ?? '';
    const encodedName = context.startsWith('ledger-person|') ? context.split('|')[2] : '';
    if (!encodedName) return pin.title;
    try {
      const name = decodeURIComponent(encodedName);
      return name && !name.includes('@') ? name : pin.title;
    } catch {
      return pin.title;
    }
  };

  const openSearchResult = (result: SearchResult) => {
    if (result.type === 'command') {
      const routeByAction: Record<string, { kind: ModuleWindowKind; focus?: ModuleFocusPayload }> = {
        overview: { kind: 'dashboard' },
        projects: { kind: 'projects' },
        notes: { kind: 'notes' },
        calendar: { kind: 'calendar' },
        settings: { kind: 'settings' },
        intake: { kind: 'inbox', focus: { focusSection: 'unprocessed' } },
        today: { kind: 'dashboard', focus: { focusSection: 'today' } },
        checkin: { kind: 'dashboard', focus: { focusSection: 'today' } },
        tasks: { kind: 'dashboard', focus: { focusSection: 'assigned' } },
        templates: { kind: 'notes', focus: { focusContext: 'try:template' } },
        notifications: { kind: 'notifications', focus: { kind: 'notifications' } },
        integrations: { kind: 'settings', focus: { focusContext: 'integrations' } },
        shortcuts: { kind: 'settings', focus: { focusContext: 'shortcuts' } },
        workspace: { kind: 'settings', focus: { focusContext: 'workspace' } },
        appearance: { kind: 'settings', focus: { focusContext: 'workspace' } },
        'new-note': { kind: 'quick-note' },
        'new-task': { kind: 'quick-task' },
        'create-project': { kind: 'projects' },
      };
      const destination = result.actionId ? routeByAction[result.actionId] : undefined;
      if (destination) openDestination(destination.kind, destination.focus);
      return;
    }
    if (result.type === 'note') return openDestination('notes', { focusNoteId: result.id });
    if (result.type === 'project') return openDestination('projects', { focusProjectId: result.id });
    if (result.type === 'task') return openDestination('projects', { focusProjectId: result.project_id, focusTaskId: result.id });
    if (result.type === 'event') return openDestination('calendar', { focusDate: result.focusDate });
    if (result.type === 'reminder' || result.type === 'intake') return openDestination('inbox', { focusSection: 'unprocessed' });
    if (result.type === 'person' || result.type === 'team') openDestination('teams');
  };

  return (
    <div
      className="relative flex h-screen min-h-0 flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none"
      style={{ scrollbarGutter: 'auto', ...workspaceShellLayout.workspaceShellStyle }}
    >
      <ModuleWindowHeader
        title="Ledger"
        stripTitle="New Tab"
        icon={<img src="./logo-color.svg" alt="" className="h-5 w-5" />}
        onClose={onClose}
        minimizeLabel="Minimize New Tab"
        onMinimize={() => void window.desktopWindow?.minimizeModule('new-tab')}
        fullscreenLabel="Fullscreen New Tab"
        onToggleFullscreen={() => void window.desktopWindow?.toggleModuleFullscreen('new-tab')}
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Funnel size={12} />}
              count={inboxCount}
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
        showHistoryControl
      />
      <main className="min-h-0 flex-1 overflow-auto bg-[var(--ledger-background)]">
        <div className="mx-auto flex w-full max-w-[680px] flex-col px-6 pb-16 pt-24">
          <img src="./logo-color.svg" alt="Ledger" className="mb-8 h-8 w-8" />
          <h1 className="text-[28px] font-regular tracking-[-0.03em] text-[var(--ledger-text-primary)]">
            Open something
          </h1>

          <button
            type="button"
            onClick={() => inputRef.current?.focus()}
            className="mt-5 flex h-12 w-full items-center gap-3 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-4 text-left shadow-[0_4px_18px_rgba(17,24,39,0.04)] transition hover:border-[color:var(--ledger-border-strong)] focus-visible:outline-none focus-visible:ring-0"
          >
            <Search size={17} className="shrink-0 text-[var(--ledger-text-muted)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              placeholder="Search pages, features, notes, projects…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
              aria-label="Search Ledger"
            />
          </button>

          <div className="relative mt-5 min-w-0">
            <div
              ref={quickNavRef}
              onWheel={(event) => {
                if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
                event.preventDefault();
                quickNavRef.current?.scrollBy({ left: event.deltaY, behavior: 'auto' });
              }}
              className="flex min-w-0 items-center gap-x-5 overflow-x-auto whitespace-nowrap pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {destinations.map(({ label, kind, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => openDestination(kind)}
                  className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
              {pins.map((pin) => (
                <button
                  key={pin.id}
                  type="button"
                  onClick={() => openPinnedItem(pin)}
                  className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
                  title={pin.subtitle ? `${getPinnedLabel(pin)} · ${pin.subtitle}` : getPinnedLabel(pin)}
                >
                  <Pin size={13} />
                  {getPinnedLabel(pin)}
                </button>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-[var(--ledger-background)] to-transparent opacity-0" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--ledger-background)] to-transparent" />
          </div>

          {trimmedQuery && (
            <div className="mt-8 space-y-0.5">
              {isLoading ? (
                <p className="px-2.5 py-3 text-sm text-[var(--ledger-text-muted)]">Searching…</p>
              ) : results.length === 0 ? (
                <p className="px-2.5 py-3 text-sm text-[var(--ledger-text-muted)]">
                  No results for “{trimmedQuery}”
                </p>
              ) : (
                results.map((result, index) => {
                  const Icon = searchIconMap[result.type];
                  const showCategory = index === 0 || results[index - 1]?.category !== result.category;
                  return (
                    <div key={`${result.type}-${result.id}`}>
                      {showCategory && (
                        <p className={`${index === 0 ? 'pt-0' : 'pt-3'} px-2 pb-1 text-[11px] font-medium text-[var(--ledger-text-muted)]`}>
                          {searchCategoryLabels[result.category]}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => openSearchResult(result)}
                        className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                      >
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
                          <Icon size={13} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ledger-text-primary)]">{result.title}</span>
                        {result.type !== 'command' && <span className="shrink-0 text-[10px] font-medium capitalize text-[var(--ledger-text-muted)]">{result.type}</span>}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {!trimmedQuery && recentRoutes.length > 0 && (
            <section className="mt-16">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">Recent</p>
                <button
                  type="button"
                  onClick={() => {
                    setRecentRoutes([]);
                    if (activeWorkspaceId) {
                      try {
                        localStorage.removeItem(getRecentRoutesStorageKey(activeWorkspaceId));
                      } catch {
                        // Ignore unavailable storage.
                      }
                    }
                    void window.desktopWindow?.clearWorkspaceRecent?.();
                  }}
                  className="rounded-md px-1.5 py-1 text-[11px] font-medium text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20"
                >
                  Clear recent
                </button>
              </div>
              <div className="space-y-0.5">
                {recentRoutes.map((route, index) => (
                  <button
                    key={`${route.kind}-${route.focusProjectId ?? route.focusNoteId ?? route.focusDate ?? index}`}
                    type="button"
                    onClick={() => openDestination(route.kind, route)}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                  >
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background-muted)] text-[var(--ledger-text-secondary)]">
                      <Search size={13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                      {routeLabel(route)}
                    </span>
                    <span className="shrink-0 text-[10px] font-medium text-[var(--ledger-text-muted)]">
                      {route.kind}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};
