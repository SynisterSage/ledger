import { useEffect, useMemo, useState } from 'react';
import { Briefcase, CalendarDays, Check, FileText, Search } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';

export type SearchResultType =
  | 'note'
  | 'project'
  | 'task'
  | 'event'
  | 'reminder'
  | 'person'
  | 'team'
  | 'intake'
  | 'command';
export type SearchCategory = 'navigate' | 'action' | 'resource' | 'settings';
export type SearchResult = {
  type: SearchResultType;
  category: SearchCategory;
  id: string;
  title: string;
  preview: string;
  icon: string;
  project_id?: string | null;
  focusDate?: string | null;
  actionId?: string;
  provider?: string | null;
  source_provider?: string | null;
};

export const searchIconMap: Record<SearchResultType, typeof FileText> = {
  note: FileText,
  project: Briefcase,
  task: Check,
  event: CalendarDays,
  reminder: CalendarDays,
  person: Briefcase,
  team: Briefcase,
  intake: FileText,
  command: Search,
};

export const searchCategoryLabels: Record<SearchCategory, string> = {
  navigate: 'Navigate',
  action: 'Features and actions',
  resource: 'Resources',
  settings: 'Settings',
};

const commands: Array<SearchResult & { keywords: string[]; personal?: boolean }> = [
  { id: 'navigate-overview', type: 'command', category: 'navigate', title: 'Overview', preview: 'Open Overview', icon: '', actionId: 'overview', keywords: ['home', 'dashboard'] },
  { id: 'navigate-projects', type: 'command', category: 'navigate', title: 'Projects', preview: 'Open Projects', icon: '', actionId: 'projects', keywords: ['project'] },
  { id: 'navigate-notes', type: 'command', category: 'navigate', title: 'Notes', preview: 'Open Notes', icon: '', actionId: 'notes', keywords: ['note'] },
  { id: 'navigate-calendar', type: 'command', category: 'navigate', title: 'Calendar', preview: 'Open Calendar', icon: '', actionId: 'calendar', keywords: ['schedule', 'event'] },
  { id: 'navigate-today', type: 'command', category: 'navigate', title: 'Today', preview: "Open today's focus", icon: '', actionId: 'today', keywords: ['today', 'focus'] },
  { id: 'navigate-tasks', type: 'command', category: 'navigate', title: 'Tasks', preview: 'Open task focus', icon: '', actionId: 'tasks', keywords: ['task', 'todo'] },
  { id: 'navigate-intake', type: 'command', category: 'navigate', title: 'Intake', preview: 'Review captured items', icon: '', actionId: 'intake', keywords: ['capture', 'inbox'] },
  { id: 'navigate-notifications', type: 'command', category: 'navigate', title: 'Notifications', preview: 'Review notifications and alerts', icon: '', actionId: 'notifications', keywords: ['notifications', 'notification', 'alerts', 'reminders', 'updates'] },
  { id: 'navigate-checkin', type: 'command', category: 'navigate', title: 'Daily Check-In', preview: 'Open your daily review', icon: '', actionId: 'checkin', keywords: ['check-in', 'checkin', 'review'] },
  { id: 'navigate-templates', type: 'command', category: 'navigate', title: 'Templates', preview: 'Browse note templates', icon: '', actionId: 'templates', keywords: ['template'] },
  { id: 'navigate-settings', type: 'command', category: 'navigate', title: 'Settings', preview: 'Open Settings', icon: '', actionId: 'settings', keywords: ['settings', 'preferences'] },
  { id: 'action-new-note', type: 'command', category: 'action', title: 'New note', preview: 'Create a blank note', icon: '', actionId: 'new-note', keywords: ['new', 'note', 'create'] },
  { id: 'action-new-task', type: 'command', category: 'action', title: 'New task', preview: 'Create a task', icon: '', actionId: 'new-task', keywords: ['new', 'task', 'create', 'todo'] },
  { id: 'action-create-project', type: 'command', category: 'action', title: 'Create project', preview: 'Start a new project', icon: '', actionId: 'create-project', keywords: ['new', 'project', 'create'] },
  { id: 'action-template-gallery', type: 'command', category: 'action', title: 'Open template gallery', preview: 'Browse note templates', icon: '', actionId: 'templates', keywords: ['browse', 'template'] },
  { id: 'action-connect-calendar', type: 'command', category: 'action', title: 'Connect calendar', preview: 'Open calendar integrations', icon: '', actionId: 'integrations', keywords: ['calendar', 'connect', 'sync'] },
  { id: 'action-install-extension', type: 'command', category: 'action', title: 'Install extension', preview: 'Open browser extension settings', icon: '', actionId: 'integrations', keywords: ['browser', 'extension', 'install'] },
  { id: 'action-invite-member', type: 'command', category: 'action', title: 'Invite member', preview: 'Invite someone to this workspace', icon: '', actionId: 'invite-member', keywords: ['invite', 'member', 'team'], personal: false },
  { id: 'settings-integrations', type: 'command', category: 'settings', title: 'Integrations', preview: 'Connected services', icon: '', actionId: 'integrations', keywords: ['integration', 'connect'] },
  { id: 'settings-shortcuts', type: 'command', category: 'settings', title: 'Shortcuts', preview: 'Keyboard shortcuts', icon: '', actionId: 'shortcuts', keywords: ['shortcut', 'keyboard'] },
  { id: 'settings-appearance', type: 'command', category: 'settings', title: 'Appearance', preview: 'Workspace appearance settings', icon: '', actionId: 'appearance', keywords: ['appearance', 'theme', 'dark', 'light'] },
  { id: 'settings-workspace', type: 'command', category: 'settings', title: 'Workspace settings', preview: 'Workspace identity and defaults', icon: '', actionId: 'workspace', keywords: ['workspace', 'settings'] },
];

export const useWorkspaceSearch = (query: string, enabled = true) => {
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const api = useApi();
  const trimmedQuery = query.trim();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const commandResults = useMemo(() => {
    const normalized = trimmedQuery.toLowerCase();
    if (!normalized) return [];
    return commands.filter((command) => {
      if (command.personal === false && activeWorkspace?.is_personal) return false;
      return [command.title, command.preview, ...command.keywords].join(' ').toLowerCase().includes(normalized);
    });
  }, [activeWorkspace?.is_personal, trimmedQuery]);

  useEffect(() => {
    if (!enabled || !user || !activeWorkspaceId) return;
    if (trimmedQuery.length < 2) {
      setResults(commandResults);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.searchWorkspace(activeWorkspaceId, trimmedQuery).then((data) => {
        if (cancelled) return;
        const resources = Array.isArray(data) ? (data as Array<Record<string, unknown>>).map((result) => {
          const rawType = String(result.type ?? 'note').toLowerCase();
          const type = ['note', 'project', 'task', 'event', 'reminder', 'person', 'team', 'intake'].includes(rawType)
            ? (rawType as SearchResultType)
            : 'note';
          return { ...(result as unknown as SearchResult), type, category: 'resource' as const, id: String(result.id ?? ''), title: String(result.title ?? 'Untitled'), preview: String(result.preview ?? ''), icon: String(result.icon ?? '') };
        }) : [];
        setResults([...commandResults, ...resources]);
        setIsLoading(false);
      }).catch(() => {
        if (!cancelled) { setResults([]); setIsLoading(false); }
      });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeWorkspaceId, api, commandResults, enabled, trimmedQuery, user]);

  return { results, isLoading, trimmedQuery };
};
