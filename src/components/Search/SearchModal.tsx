import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accessibility,
  Bell,
  Briefcase,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CircleAlert,
  FileText,
  Inbox,
  Keyboard,
  LayoutDashboard,
  ListTree,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointer2,
  Palette,
  PanelLeft,
  Plug2,
  RotateCcw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useSearch } from '../../context/SearchContext';
import { useApi } from '../../hooks/useApi';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';

type SearchResultType =
  | 'note'
  | 'project'
  | 'task'
  | 'event'
  | 'reminder'
  | 'person'
  | 'team'
  | 'intake'
  | 'github'
  | 'command';
type SearchCategory = 'navigate' | 'action' | 'resource' | 'settings';

type SearchResult = {
  type: SearchResultType;
  category: SearchCategory;
  id: string;
  title: string;
  preview: string;
  icon: string;
  project_id?: string | null;
  focusDate?: string | null;
  actionId?: string;
};

const settingsSearchEntries: Array<{
  pageId: string;
  pageTitle: string;
  sections: Array<{ id: string; title: string }>;
}> = [
  {
    pageId: 'account',
    pageTitle: 'Account',
    sections: [
      { id: 'settings-profile', title: 'Profile' },
      { id: 'settings-security', title: 'Security' },
      { id: 'settings-account-actions', title: 'Account actions' },
    ],
  },
  {
    pageId: 'sessions',
    pageTitle: 'Sessions',
    sections: [
      { id: 'settings-current-session', title: 'Current session' },
      { id: 'settings-other-sessions', title: 'Other sessions' },
    ],
  },
  {
    pageId: 'workspace',
    pageTitle: 'Workspace',
    sections: [
      { id: 'settings-current-workspace', title: 'Current workspace' },
      { id: 'settings-appearance', title: 'Appearance' },
      { id: 'settings-defaults', title: 'Defaults' },
      { id: 'settings-danger-zone', title: 'Danger zone' },
    ],
  },
  {
    pageId: 'members',
    pageTitle: 'Members & access',
    sections: [
      { id: 'settings-members', title: 'Members' },
      { id: 'settings-invites', title: 'Invites' },
      { id: 'settings-teams', title: 'Teams' },
    ],
  },
  {
    pageId: 'calendar',
    pageTitle: 'Calendar',
    sections: [
      { id: 'calendar-defaults', title: 'Event defaults' },
      { id: 'calendar-display', title: 'Calendar display' },
    ],
  },
  {
    pageId: 'notifications',
    pageTitle: 'Notifications',
    sections: [
      { id: 'notification-control', title: 'Control' },
      { id: 'notification-delivery', title: 'Delivery' },
      { id: 'notification-sources', title: 'Sources' },
      { id: 'notification-timing', title: 'Timing' },
      { id: 'notification-behavior', title: 'Behavior' },
    ],
  },
  {
    pageId: 'integrations',
    pageTitle: 'Integrations',
    sections: [{ id: 'integration-list', title: 'Connected' }],
  },
  {
    pageId: 'sidebar',
    pageTitle: 'Sidebar',
    sections: [
      { id: 'sidebar-placement', title: 'Placement' },
      { id: 'sidebar-appearance', title: 'Appearance' },
      { id: 'sidebar-behavior', title: 'Behavior' },
      { id: 'sidebar-reset', title: 'Reset' },
    ],
  },
  {
    pageId: 'accessibility',
    pageTitle: 'Accessibility',
    sections: [
      { id: 'accessibility-core', title: 'Accessibility' },
      { id: 'accessibility-startup', title: 'Startup' },
    ],
  },
  {
    pageId: 'shortcuts',
    pageTitle: 'Keyboard shortcuts',
    sections: [
      { id: 'shortcut-sidebar', title: 'Sidebar shortcuts' },
      { id: 'shortcut-search', title: 'Search shortcuts' },
      { id: 'shortcut-navigation', title: 'Navigation shortcuts' },
      { id: 'shortcut-general', title: 'General shortcuts' },
      { id: 'shortcut-mouse-actions', title: 'Mouse actions' },
    ],
  },
];

const settingsSearchCommands: Array<SearchResult & { keywords: string[] }> =
  settingsSearchEntries.flatMap(({ pageId, pageTitle, sections }) => [
    {
      id: `settings-page-${pageId}`,
      type: 'command' as const,
      category: 'settings' as const,
      title: pageTitle,
      preview: `Open Settings · ${pageTitle}`,
      icon: '',
      actionId: `settings-page:${pageId}`,
      keywords: ['settings', 'preferences', pageTitle.toLowerCase()],
    },
    ...sections.map((section) => ({
      id: `settings-section-${pageId}-${section.id}`,
      type: 'command' as const,
      category: 'settings' as const,
      title: `${pageTitle} · ${section.title}`,
      preview: `Open Settings · ${pageTitle} · ${section.title}`,
      icon: '',
      actionId: `settings-section:${pageId}:${section.id}`,
      keywords: ['settings', 'preferences', pageTitle.toLowerCase(), section.title.toLowerCase()],
    })),
  ]);

const iconMap: Record<SearchResultType, typeof FileText> = {
  note: FileText,
  project: Briefcase,
  task: Check,
  event: CalendarDays,
  reminder: CalendarDays,
  person: Briefcase,
  team: Briefcase,
  intake: FileText,
  github: Plug2,
  command: Search,
};

const commandIconMap: Record<string, typeof FileText> = {
  overview: LayoutDashboard,
  projects: Briefcase,
  notes: FileText,
  calendar: CalendarDays,
  today: Check,
  checkin: Check,
  tasks: Check,
  intake: Inbox,
  notifications: Bell,
  templates: FileText,
  settings: Settings,
  'new-note': FileText,
  'new-task': Check,
  'create-project': Briefcase,
  'template-gallery': FileText,
  'connect-calendar': CalendarDays,
  'install-extension': Plug2,
  'invite-member': Users,
  integrations: Plug2,
  shortcuts: Keyboard,
  workspace: BriefcaseBusiness,
  appearance: Palette,
};

const settingsPageIconMap: Record<string, typeof FileText> = {
  account: UserRound,
  sessions: Shield,
  workspace: BriefcaseBusiness,
  members: Users,
  calendar: CalendarDays,
  notifications: Bell,
  integrations: Plug2,
  sidebar: PanelLeft,
  accessibility: Accessibility,
  shortcuts: Keyboard,
};

const settingsSectionIconMap: Record<string, typeof FileText> = {
  'settings-profile': UserRound,
  'settings-security': Shield,
  'settings-account-actions': Settings,
  'settings-current-session': Monitor,
  'settings-other-sessions': Shield,
  'settings-current-workspace': BriefcaseBusiness,
  'settings-appearance': Palette,
  'settings-defaults': Settings,
  'settings-danger-zone': CircleAlert,
  'settings-members': Users,
  'settings-invites': Users,
  'settings-teams': ListTree,
  'calendar-defaults': CalendarDays,
  'calendar-display': CalendarDays,
  'notification-control': Bell,
  'notification-delivery': Bell,
  'notification-sources': Bell,
  'notification-timing': Bell,
  'notification-behavior': Settings,
  'integration-list': Plug2,
  'sidebar-placement': PanelLeft,
  'sidebar-appearance': Palette,
  'sidebar-behavior': Settings,
  'sidebar-reset': RotateCcw,
  'accessibility-core': SlidersHorizontal,
  'accessibility-startup': Monitor,
  'shortcut-sidebar': PanelLeft,
  'shortcut-search': Search,
  'shortcut-navigation': Keyboard,
  'shortcut-general': Keyboard,
  'shortcut-mouse-actions': MousePointer2,
};

const getSearchResultIcon = (result: SearchResult) => {
  if (result.type !== 'command') return iconMap[result.type];

  const actionId = result.actionId ?? '';
  if (actionId.startsWith('settings-section:')) {
    const anchorId = actionId.split(':')[2];
    return settingsSectionIconMap[anchorId] ?? Settings;
  }
  if (actionId.startsWith('settings-page:')) {
    return settingsPageIconMap[actionId.slice('settings-page:'.length)] ?? Settings;
  }
  return commandIconMap[actionId] ?? Search;
};

const ledgerSearchCommands: Array<SearchResult & { keywords: string[]; personal?: boolean }> = [
  {
    id: 'navigate-overview',
    type: 'command',
    category: 'navigate',
    title: 'Overview',
    preview: 'Open Overview',
    icon: '',
    actionId: 'overview',
    keywords: ['home', 'dashboard'],
  },
  {
    id: 'navigate-projects',
    type: 'command',
    category: 'navigate',
    title: 'Projects',
    preview: 'Open Projects',
    icon: '',
    actionId: 'projects',
    keywords: ['project'],
  },
  {
    id: 'navigate-notes',
    type: 'command',
    category: 'navigate',
    title: 'Notes',
    preview: 'Open Notes',
    icon: '',
    actionId: 'notes',
    keywords: ['note'],
  },
  {
    id: 'navigate-calendar',
    type: 'command',
    category: 'navigate',
    title: 'Calendar',
    preview: 'Open Calendar',
    icon: '',
    actionId: 'calendar',
    keywords: ['schedule', 'event'],
  },
  {
    id: 'navigate-today',
    type: 'command',
    category: 'navigate',
    title: 'Today',
    preview: "Open today's focus",
    icon: '',
    actionId: 'today',
    keywords: ['today', 'focus'],
  },
  {
    id: 'navigate-tasks',
    type: 'command',
    category: 'navigate',
    title: 'Tasks',
    preview: 'Open task focus',
    icon: '',
    actionId: 'tasks',
    keywords: ['task', 'todo'],
  },
  {
    id: 'navigate-intake',
    type: 'command',
    category: 'navigate',
    title: 'Intake',
    preview: 'Review captured items',
    icon: '',
    actionId: 'intake',
    keywords: ['capture', 'inbox'],
  },
  {
    id: 'navigate-notifications',
    type: 'command',
    category: 'navigate',
    title: 'Notifications',
    preview: 'Review notifications and alerts',
    icon: '',
    actionId: 'notifications',
    keywords: ['notifications', 'notification', 'alerts', 'reminders', 'updates'],
  },
  {
    id: 'navigate-checkin',
    type: 'command',
    category: 'navigate',
    title: 'Daily Check-In',
    preview: 'Open your daily review',
    icon: '',
    actionId: 'checkin',
    keywords: ['check-in', 'checkin', 'review'],
  },
  {
    id: 'navigate-templates',
    type: 'command',
    category: 'navigate',
    title: 'Templates',
    preview: 'Browse note templates',
    icon: '',
    actionId: 'templates',
    keywords: ['template'],
  },
  {
    id: 'navigate-settings',
    type: 'command',
    category: 'navigate',
    title: 'Settings',
    preview: 'Open Settings',
    icon: '',
    actionId: 'settings',
    keywords: ['settings', 'preferences'],
  },
  {
    id: 'action-new-note',
    type: 'command',
    category: 'action',
    title: 'New note',
    preview: 'Create a blank note',
    icon: '',
    actionId: 'new-note',
    keywords: ['new', 'note', 'create'],
  },
  {
    id: 'action-new-task',
    type: 'command',
    category: 'action',
    title: 'New task',
    preview: 'Create a task',
    icon: '',
    actionId: 'new-task',
    keywords: ['new', 'task', 'create', 'todo'],
  },
  {
    id: 'action-create-project',
    type: 'command',
    category: 'action',
    title: 'Create project',
    preview: 'Start a new project',
    icon: '',
    actionId: 'create-project',
    keywords: ['new', 'project', 'create'],
  },
  {
    id: 'action-template-gallery',
    type: 'command',
    category: 'action',
    title: 'Open template gallery',
    preview: 'Browse note templates',
    icon: '',
    actionId: 'templates',
    keywords: ['browse', 'template'],
  },
  {
    id: 'action-connect-calendar',
    type: 'command',
    category: 'action',
    title: 'Connect calendar',
    preview: 'Open calendar integrations',
    icon: '',
    actionId: 'integrations',
    keywords: ['calendar', 'connect', 'sync'],
  },
  {
    id: 'action-install-extension',
    type: 'command',
    category: 'action',
    title: 'Install extension',
    preview: 'Open browser extension settings',
    icon: '',
    actionId: 'integrations',
    keywords: ['browser', 'extension', 'install'],
  },
  {
    id: 'action-invite-member',
    type: 'command',
    category: 'action',
    title: 'Invite member',
    preview: 'Invite someone to this workspace',
    icon: '',
    actionId: 'invite-member',
    keywords: ['invite', 'member', 'team'],
    personal: false,
  },
  ...settingsSearchCommands,
];

const searchCategoryLabels: Record<SearchCategory, string> = {
  navigate: 'Navigate',
  action: 'Features and actions',
  resource: 'Resources',
  settings: 'Settings',
};

export const SearchModal = () => {
  const isModuleWindow = new URLSearchParams(window.location.search).get('window') === 'module';
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const { isSearchOpen, initialQuery, closeSearch } = useSearch();
  const api = useApi();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchIdRef = useRef(0);
  const resultsRef = useRef<SearchResult[]>([]);
  const selectedIndexRef = useRef(0);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Keep refs in sync with state
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const trimmedQuery = query.trim();
  const commandResults = useMemo(() => {
    const normalizedQuery = trimmedQuery.toLowerCase();
    if (!normalizedQuery) return [];
    return ledgerSearchCommands.filter((command) => {
      if (command.personal === false && activeWorkspace?.is_personal) return false;
      const haystack = [command.title, command.preview, ...command.keywords]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [activeWorkspace?.is_personal, trimmedQuery]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    setQuery(initialQuery);
    setResults([]);
    setSelectedIndex(0);
    setIsFullscreen(false);

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 20);

    return () => window.clearTimeout(timer);
  }, [initialQuery, isSearchOpen]);

  const activeResult = useMemo(() => results[selectedIndex] ?? null, [results, selectedIndex]);

  useEffect(() => {
    if (!isSearchOpen || !user || !activeWorkspaceId) {
      return;
    }

    if (trimmedQuery.length < 2) {
      setResults(commandResults);
      setIsLoading(false);
      setSelectedIndex(0);
      return;
    }

    setIsLoading(true);
    const searchId = searchIdRef.current + 1;
    searchIdRef.current = searchId;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void api
        .searchWorkspace(activeWorkspaceId, trimmedQuery)
        .then((data) => {
          if (cancelled || searchIdRef.current !== searchId) return;
          const resources = Array.isArray(data)
            ? (data as Array<Record<string, unknown>>).map((result) => {
                const rawType = String(result.type ?? 'note').toLowerCase();
                const type: SearchResultType = [
                  'note',
                  'project',
                  'task',
                  'event',
                  'reminder',
                  'person',
                  'team',
                  'intake',
                  'github',
                ].includes(rawType)
                  ? (rawType as SearchResultType)
                  : 'note';
                return {
                  ...(result as unknown as SearchResult),
                  type,
                  category: 'resource' as const,
                  id: String(result.id ?? ''),
                  title: String(result.title ?? 'Untitled'),
                  preview: String(result.preview ?? ''),
                  icon: String(result.icon ?? ''),
                };
              })
            : [];
          const next = [...commandResults, ...resources];
          setResults(next);
          setSelectedIndex(0);
        })
        .catch((error) => {
          if (cancelled || searchIdRef.current !== searchId) return;
          console.error('Search failed:', error);
          setResults([]);
        })
        .finally(() => {
          if (cancelled || searchIdRef.current !== searchId) return;
          setIsLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeWorkspaceId, api, commandResults, isSearchOpen, trimmedQuery, user]);

  useEffect(() => {
    const selected = itemRefs.current[selectedIndex];
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, results]);

  useEffect(() => {
    if (!isSearchOpen) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
  }, [isSearchOpen]);

  const jumpToResult = useCallback(
    (result: SearchResult) => {
      if (result.type === 'command') {
        if (result.actionId?.startsWith('settings-page:')) {
          const pageId = result.actionId.slice('settings-page:'.length);
          void window.desktopWindow?.openModule('settings', {
            kind: 'settings',
            focusSection: pageId,
          });
          closeSearch();
          return;
        }

        if (result.actionId?.startsWith('settings-section:')) {
          const [, pageId, anchorId] = result.actionId.split(':');
          void window.desktopWindow?.openModule('settings', {
            kind: 'settings',
            focusSection: pageId,
            focusContext: `settings-anchor:${anchorId}`,
          });
          closeSearch();
          return;
        }

        switch (result.actionId) {
          case 'overview':
            void window.desktopWindow?.openModule('dashboard');
            break;
          case 'settings':
            void window.desktopWindow?.openModule('settings');
            break;
          case 'projects':
          case 'create-project':
            void window.desktopWindow?.openModule('projects');
            break;
          case 'notes':
            void window.desktopWindow?.openModule('notes');
            break;
          case 'calendar':
            void window.desktopWindow?.openModule('calendar');
            break;
          case 'today':
          case 'checkin':
            void window.desktopWindow?.openModule('dashboard', {
              kind: 'dashboard',
              focusSection: 'today',
            });
            break;
          case 'tasks':
            void window.desktopWindow?.openModule('dashboard', {
              kind: 'dashboard',
              focusSection: 'assigned',
            });
            break;
          case 'intake':
            void window.desktopWindow?.openModule('inbox', {
              kind: 'inbox',
              focusSection: 'unprocessed',
            });
            break;
          case 'notifications':
            void window.desktopWindow?.openModule('notifications', { kind: 'notifications' });
            break;
          case 'templates':
            void window.desktopWindow?.openModule('notes', {
              kind: 'notes',
              focusContext: 'try:template',
            });
            break;
          case 'new-note':
            void window.desktopWindow?.openModule('quick-note', { kind: 'quick-note' });
            break;
          case 'new-task':
            void window.desktopWindow?.openModule('quick-task', { kind: 'quick-task' });
            break;
          case 'invite-member':
            void window.desktopWindow?.openModule('teams', {
              kind: 'teams',
              focusContext: 'try:invite-member',
            });
            break;
          case 'integrations':
            void window.desktopWindow?.openModule('settings', {
              kind: 'settings',
              focusContext: 'integrations',
            });
            break;
          case 'shortcuts':
            void window.desktopWindow?.openModule('settings', {
              kind: 'settings',
              focusContext: 'shortcuts',
            });
            break;
          case 'workspace':
          case 'appearance':
            void window.desktopWindow?.openModule('settings', {
              kind: 'settings',
              focusContext: 'workspace',
            });
            break;
        }
      } else if (result.type === 'note') {
        void window.desktopWindow?.toggleModule('notes', { focusNoteId: result.id });
      } else if (result.type === 'project') {
        void window.desktopWindow?.toggleModule('projects', { focusProjectId: result.id });
      } else if (result.type === 'task') {
        void window.desktopWindow?.toggleModule('projects', {
          focusProjectId: result.project_id ?? undefined,
          focusTaskId: result.id,
        });
      } else if (result.type === 'event') {
        const focusDate = result.focusDate ?? undefined;
        void window.desktopWindow?.openModule('calendar', focusDate ? { focusDate } : undefined);
      } else if (result.type === 'reminder' || result.type === 'intake') {
        void window.desktopWindow?.openModule('inbox', { focusSection: 'unprocessed' });
      } else if (result.type === 'github') {
        const url = (result as SearchResult & { external_url?: string }).external_url;
        if (url) void window.desktopWindow?.openExternal(url);
      } else if (result.type === 'person' || result.type === 'team') {
        void window.desktopWindow?.openModule('teams');
      }

      closeSearch();
    },
    [closeSearch]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSearch();
        return;
      }

      if (event.key === 'ArrowDown') {
        if (resultsRef.current.length === 0) return;
        event.preventDefault();
        setSelectedIndex((current) => Math.min(current + 1, resultsRef.current.length - 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        if (resultsRef.current.length === 0) return;
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === 'Enter') {
        const activeResult = resultsRef.current[selectedIndexRef.current];
        if (!activeResult) return;
        event.preventDefault();
        jumpToResult(activeResult);
      }
    },
    [closeSearch, jumpToResult]
  );

  useEffect(() => {
    if (!isSearchOpen) return;

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSearchOpen, onKeyDown]);

  if (!isSearchOpen || typeof document === 'undefined' || !user || !activeWorkspaceId) {
    return null;
  }

  const shellClassName = isFullscreen
    ? 'fixed inset-0 z-[220] bg-transparent p-4 sm:p-8'
    : 'fixed inset-0 z-[220] flex items-start justify-center bg-transparent px-4 pt-16';

  const panelClassName = isFullscreen
    ? 'flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-[0_24px_70px_rgba(17,24,39,0.12)]'
    : `flex h-[400px] w-full ${
        isModuleWindow ? 'max-w-[680px]' : 'max-w-[500px]'
      } flex-col overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-[0_24px_70px_rgba(17,24,39,0.12)]`;

  const searchPanel = (
    <div className={panelClassName} onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2">
          <Search size={16} className="shrink-0 text-[var(--ledger-text-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeSearch();
              }
            }}
            placeholder="Search everything..."
            className="w-full bg-transparent text-sm text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsFullscreen((current) => !current)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <ModalCloseButton onClick={closeSearch} ariaLabel="Close search" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {!trimmedQuery ? (
          <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ledger-text-muted)]">
            Start typing to search...
          </div>
        ) : trimmedQuery.length < 2 && commandResults.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ledger-text-muted)]">
            Type at least 2 characters to search.
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ledger-text-muted)]">
            Searching…
          </div>
        ) : results.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ledger-text-muted)]">
            No results for “{trimmedQuery}”
          </div>
        ) : (
          <div className="space-y-0.5">
            {results.map((result, index) => {
              const Icon = getSearchResultIcon(result);
              const selected = index === selectedIndex;
              const showCategory = index === 0 || results[index - 1]?.category !== result.category;

              return (
                <div key={`${result.type}-${result.id}`}>
                  {showCategory && (
                    <p
                      className={`${
                        index === 0 ? 'pt-0' : 'pt-3'
                      } px-2 pb-1 text-[11px] font-medium text-[var(--ledger-text-muted)]`}
                    >
                      {searchCategoryLabels[result.category]}
                    </p>
                  )}
                  <button
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => jumpToResult(result)}
                    className={`flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left transition ${
                      selected
                        ? 'bg-[var(--ledger-surface-hover)]'
                        : 'hover:bg-[var(--ledger-surface-hover)]'
                    }`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                        selected
                          ? 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-secondary)]'
                          : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]'
                      }`}
                    >
                      <Icon size={13} />
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                      {result.title}
                    </p>
                    {result.type !== 'command' && (
                      <span className="shrink-0 text-[10px] font-medium capitalize text-[var(--ledger-text-muted)]">
                        {result.type}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[color:var(--ledger-border-subtle)] px-4 py-3 text-[11px] text-[var(--ledger-text-muted)]">
        <span className="min-w-0 flex-1 truncate">
          ↑↓ to navigate • Enter to jump • ESC to close
        </span>
        <span className="hidden max-w-[42%] shrink-0 truncate text-right min-[460px]:inline">
          {activeResult ? `${activeResult.type} selected` : ' '}
        </span>
      </div>
    </div>
  );

  if (isModuleWindow) {
    return (
      <ModalOverlay
        isOpen={isSearchOpen}
        onClose={closeSearch}
        backdropBorderRadius="var(--window-radius)"
        backdropInset="0px"
        manageWindowChrome={false}
        classNameContainer={`${
          isFullscreen ? 'h-full w-full' : 'w-full max-w-[680px]'
        } !overflow-visible !rounded-none !border-0 !bg-transparent !p-0 !shadow-none`}
      >
        {searchPanel}
      </ModalOverlay>
    );
  }

  return createPortal(
    <div className={shellClassName} onMouseDown={closeSearch}>
      {searchPanel}
    </div>,
    document.body
  );
};
