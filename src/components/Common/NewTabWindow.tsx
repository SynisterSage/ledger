import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, FileText, FolderKanban, Funnel, Inbox, LayoutList, Search } from 'lucide-react';
import { ModuleHeaderStripAction, ModuleWindowHeader } from './ModuleWindowHeader';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import {
  searchCategoryLabels,
  searchIconMap,
  type SearchResult,
  useWorkspaceSearch,
} from '../Search/useWorkspaceSearch';

type RecentRoute = ModuleFocusPayload & { kind: ModuleWindowKind };

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
  const api = useApi();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const { results, isLoading, trimmedQuery } = useWorkspaceSearch(query);

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
    inputRef.current?.focus();
    void window.desktopWindow?.getWorkspaceNavigationState?.().then((state) => {
      const routes = (state?.recentRoutes ?? []).filter(
        (route): route is RecentRoute => Boolean(route?.kind && route.kind !== 'new-tab')
      );
      setRecentRoutes(routes.slice(-3).reverse());
    });
  }, []);

  const openDestination = (kind: ModuleWindowKind, route?: ModuleFocusPayload) => {
    void window.desktopWindow?.openModule(kind, { kind, ...(route ?? {}) });
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
        notifications: { kind: 'settings', focus: { focusContext: 'notifications' } },
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
    <div className="relative flex h-screen min-h-0 flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none">
      <ModuleWindowHeader
        title="Ledger"
        stripTitle="New Tab"
        icon={<img src="./logo-color.svg" alt="" className="h-5 w-5" />}
        onClose={onClose}
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
              onClick={() => void window.desktopWindow?.openModule('notifications')}
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

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            {destinations.map(({ label, kind, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => openDestination(kind)}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
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
              <p className="mb-2 text-[11px] font-medium text-[var(--ledger-text-muted)]">Recent</p>
              <div className="space-y-0.5">
                {recentRoutes.map((route, index) => (
                  <button
                    key={`${route.kind}-${route.focusProjectId ?? route.focusNoteId ?? route.focusDate ?? index}`}
                    type="button"
                    onClick={() => openDestination(route.kind, route)}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                  >
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
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
