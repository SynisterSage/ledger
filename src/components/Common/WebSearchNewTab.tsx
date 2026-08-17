import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Download, FileText, FolderKanban, Inbox, Search, Users, X } from 'lucide-react';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { usePlatform } from '../../platform';
import {
  routeForCalendarEvent,
  routeForCalendarReminder,
  routeForInboxItem,
  routeForNote,
  routeForProject,
  routeForTask,
  routeForTeam,
} from '../../platform';
import { ModuleWindowHeader } from './ModuleWindowHeader';
import { runtimeConfig } from '../../config/runtime';
import {
  useWorkspaceSearch,
  type SearchResult,
  type SearchResultType,
} from '../Search/useWorkspaceSearch';

const iconFor = (type: SearchResultType) =>
  ((
    {
      project: FolderKanban,
      task: Check,
      note: FileText,
      event: CalendarDays,
      reminder: CalendarDays,
      intake: Inbox,
      team: Users,
      transcript: FileText,
      meeting_metadata: CalendarDays,
      command: Search,
    } as Partial<Record<SearchResultType, typeof FileText>>
  )[type] ?? FileText);
const labelFor = (type: SearchResultType) =>
  ((
    {
      project: 'Project',
      task: 'Task',
      note: 'Note',
      event: 'Event',
      reminder: 'Reminder',
      intake: 'Intake',
      team: 'Team',
      transcript: 'Transcript',
      meeting_metadata: 'Meeting',
      command: 'Navigate',
    } as Partial<Record<SearchResultType, string>>
  )[type] ?? 'Resource');

const resultRoute = (workspaceId: string, result: SearchResult) => {
  if (result.type === 'command') {
    const commandRoutes = {
      overview: { kind: 'workspace' as const, workspaceId, page: 'dashboard' as const },
      projects: routeForProject(workspaceId),
      notes: routeForNote(workspaceId),
      calendar: { kind: 'workspace' as const, workspaceId, page: 'calendar' as const },
      today: { kind: 'workspace' as const, workspaceId, page: 'today' as const },
      tasks: {
        kind: 'workspace' as const,
        workspaceId,
        page: 'dashboard' as const,
        query: { section: 'assigned' as const },
      },
      intake: routeForInboxItem(workspaceId),
      notifications: { kind: 'workspace' as const, workspaceId, page: 'notifications' as const },
      settings: {
        kind: 'workspace' as const,
        workspaceId,
        page: 'settings' as const,
        scope: 'workspace' as const,
        section: 'workspace' as const,
      },
      integrations: {
        kind: 'workspace' as const,
        workspaceId,
        page: 'settings' as const,
        scope: 'workspace' as const,
        section: 'integrations' as const,
      },
    };
    return commandRoutes[result.actionId as keyof typeof commandRoutes] ?? null;
  }
  if (result.type === 'project') return routeForProject(workspaceId, result.id);
  if (result.type === 'task')
    return result.project_id
      ? routeForProject(workspaceId, result.project_id, result.id)
      : routeForTask(workspaceId, result.id);
  if (result.type === 'note' || result.type === 'transcript' || result.type === 'meeting_metadata')
    return routeForNote(workspaceId, result.note_id ?? result.id);
  if (result.type === 'event')
    return routeForCalendarEvent(workspaceId, result.id, result.focusDate ?? undefined);
  if (result.type === 'reminder') return routeForCalendarReminder(workspaceId, result.id);
  if (result.type === 'intake') return routeForInboxItem(workspaceId, result.id);
  if (result.type === 'team') return routeForTeam(workspaceId, result.id);
  if (result.type === 'person')
    return {
      kind: 'workspace' as const,
      workspaceId,
      page: 'circle' as const,
      query: { person: result.id },
    };
  return null;
};

const WEB_ASK_LEDGER_TOAST_DISMISSED = 'ledger:web-ask-ledger-toast-dismissed:v1';

const WebAskLedgerToast = () => {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(WEB_ASK_LEDGER_TOAST_DISMISSED) === 'true');
    } catch {
      // Storage is optional; the toast can still be dismissed for this session.
    }
  }, []);

  if (dismissed) return null;
  const downloadUrl = `${(runtimeConfig.ledgerWebUrl || 'https://ledgerworkspace.com').replace(/\/$/, '')}/download`;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(WEB_ASK_LEDGER_TOAST_DISMISSED, 'true');
    } catch {
      // Ignore unavailable browser storage.
    }
  };

  return (
    <aside className="fixed bottom-5 right-5 z-[60] w-[min(350px,calc(100vw-2rem))] rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-3.5 shadow-[0_14px_36px_rgba(17,24,39,0.16)]" role="status" aria-label="Try Ask Ledger on desktop and mobile">
      <button type="button" onClick={dismiss} aria-label="Dismiss Ask Ledger message" className="absolute right-2.5 top-2.5 rounded-md p-1 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><X size={14} /></button>
      <div className="flex items-start gap-3 pr-5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-secondary)]"><Download size={15} /></span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Try the new Ask Ledger</p>
          <p className="mt-0.5 text-xs leading-5 text-[var(--ledger-text-muted)]">Available on desktop and mobile.</p>
          <a href={downloadUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-medium text-[var(--ledger-text-secondary)] underline decoration-[var(--ledger-border-strong)] underline-offset-2 transition hover:text-[var(--ledger-text-primary)]">Download Ledger</a>
        </div>
      </div>
    </aside>
  );
};

export const WebSearchNewTab = ({ onClose }: { onClose: () => void }) => {
  const { activeWorkspaceId } = useWorkspaceContext();
  const platform = usePlatform();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { results, isLoading: loading } = useWorkspaceSearch(query);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeWorkspaceId]);
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const openResult = (result: SearchResult) => {
    if (!activeWorkspaceId) return;
    if (result.type === 'external_reference' && result.external_url) {
      void platform.externalLinks.open(result.external_url, { newTab: true });
      return;
    }
    if (
      result.type === 'command' &&
      (result.actionId === 'new-note' || result.actionId === 'new-task')
    ) {
      platform.navigation.openOverlay({
        kind: 'overlay',
        workspaceId: activeWorkspaceId,
        page: 'capture',
        action: result.actionId === 'new-note' ? 'note' : 'task',
      });
      return;
    }
    const route = resultRoute(activeWorkspaceId, result);
    if (route) platform.navigation.openRoute(route);
  };

  return (
    <div className="relative flex h-screen min-h-0 flex-col overflow-hidden rounded-[var(--ledger-window-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)]">
      <ModuleWindowHeader
        title="Ledger"
        stripTitle="New tab"
        icon={<img src={`${import.meta.env.BASE_URL}logo-color.svg`} alt="" className="h-5 w-5" />}
        onClose={onClose}
        minimizeLabel="Minimize New Tab"
        fullscreenLabel="Fullscreen New Tab"
        showBodyHeader={false}
        showWorkspaceNavigation
      />
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[700px] flex-col px-5 pb-16 pt-[clamp(72px,14vh,150px)] sm:px-6">
          <p className="mb-5 px-1 text-sm font-medium text-[var(--ledger-text-muted)]">New tab</p>
          <div className="relative">
            <Search
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--ledger-text-muted)]"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  setSelectedIndex(0);
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedIndex((index) => Math.max(0, index - 1));
                }
                if (event.key === 'Enter' && results[selectedIndex]) {
                  event.preventDefault();
                  openResult(results[selectedIndex]);
                }
              }}
              placeholder="Search Ledger..."
              aria-label="Search Ledger"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="web-new-tab-search-results"
              className="h-14 w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] pl-12 pr-4 text-base text-[var(--ledger-text-primary)] shadow-[0_4px_18px_rgba(17,24,39,0.04)] outline-none placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)]"
            />
            {(loading || results.length > 0) && (
              <div
                id="web-new-tab-search-results"
                role="listbox"
                className="mt-2 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"
              >
                {loading ? (
                  <p className="px-3 py-3 text-sm text-[var(--ledger-text-muted)]">Searching…</p>
                ) : (
                  results.map((result, index) => {
                    const Icon = iconFor(result.type);
                    return (
                      <button
                        key={`${result.type}:${result.id}`}
                        type="button"
                        role="option"
                        aria-selected={selectedIndex === index}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => openResult(result)}
                        className={`flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left ${
                          selectedIndex === index ? 'bg-[var(--ledger-surface-hover)]' : ''
                        }`}
                      >
                        <Icon size={15} className="shrink-0 text-[var(--ledger-text-muted)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[var(--ledger-text-primary)]">
                            {result.title}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-[var(--ledger-text-muted)]">
                            {result.preview || result.context_label || result.project_name || ' '}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">
                          {labelFor(result.type)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <WebAskLedgerToast />
    </div>
  );
};
