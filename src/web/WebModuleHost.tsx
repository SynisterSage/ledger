import { useEffect } from 'react';
import { useSearch } from '../context/SearchContext';
import { usePlatform } from '../platform';
import type { LedgerWorkspaceRoute } from '../platform';
import { DashboardContent } from '../App';
import { NewTabWindow } from '../components/Common/NewTabWindow';
import { CircleWindow } from '../components/Circle/CircleWindow';
import CalendarWindow from '../components/Calendar/CalendarWindow';
import { NotesWindow } from '../components/Notes/NotesWindow';
import ProjectsWindow from '../components/Projects/ProjectsWindow';
import TeamsWindow from '../components/Teams/TeamsWindow';
import TeamSettingsWindow from '../components/Teams/TeamSettingsWindow';
import IntakeWindow from '../components/Inbox/InboxWindow';
import SlackWindow from '../components/Slack/SlackWindow';
import { NotificationCenterWindow } from '../components/Notifications/NotificationCenterWindow';
import SettingsWindow from '../components/Settings/SettingsWindow';

const NotMounted = ({ label }: { label: string }) => (
  <div className="flex h-full items-center justify-center bg-[var(--ledger-background)] px-6 text-sm text-[var(--ledger-text-muted)]">
    {label} is not available in this workspace.
  </div>
);

const WebSearchRoute = ({ query }: { query: string }) => {
  const { openSearch } = useSearch();
  useEffect(() => { openSearch(query); }, [openSearch, query]);
  return <NotMounted label="Search" />;
};

export const WebModuleHost = ({ route }: { route: LedgerWorkspaceRoute }) => {
  const platform = usePlatform();
  const closeToHome = () => platform.navigation.openRoute({ kind: 'workspace', workspaceId: route.workspaceId, page: 'home' });

  switch (route.page) {
    case 'home': return <NewTabWindow isBrowser onClose={closeToHome} />;
    case 'dashboard':
    case 'today': {
      const section = route.page === 'today' ? 'today' : route.query?.section === 'today' ? 'today' : route.query?.section === 'assigned' ? 'assigned' : 'all';
      return <DashboardContent browserMode initialSection={section} onBrowserClose={closeToHome} />;
    }
    case 'circle': return <CircleWindow focusContext={route.query?.person ? `ledger-person|${route.query.person}||overview` : route.query?.context} />;
    case 'calendar': return <CalendarWindow webQuery={route.query} />;
    case 'notes': return <NotesWindow key="notes-home" />;
    case 'note': return <NotesWindow key={`note:${route.noteId}:${route.query?.view ?? ''}`} focusContext={`focus-note:${route.noteId}`} initialView={route.query?.view} />;
    case 'projects': return <ProjectsWindow key="projects-home" />;
    case 'project': return <ProjectsWindow key={`project:${route.projectId}:${route.taskId ?? ''}`} webQuery={{ projectId: route.projectId, taskId: route.taskId }} />;
    case 'teams': return <TeamsWindow />;
    case 'team': return route.settings ? <TeamSettingsWindow focusContext={`team-settings:${route.teamId}`} /> : <TeamsWindow focusContext={`team:${route.teamId}`} />;
    case 'inbox': return <IntakeWindow webQuery={route.query} />;
    case 'slack': return <SlackWindow routeWorkspaceId={route.workspaceId} />;
    case 'notifications': return <NotificationCenterWindow mode="window" initialFilter={route.query?.filter} initialItem={route.query?.item} />;
    case 'search': return <WebSearchRoute query={route.query.q} />;
    case 'settings': return <SettingsWindow initialSection={(route.section === 'meeting-notes' ? 'meeting_notes' : ['google-drive', 'github', 'slack', 'figma'].includes(route.section) ? 'integrations' : route.section) as 'workspace' | 'members' | 'calendar' | 'notifications' | 'sidebar' | 'meeting_notes' | 'integrations'} />;
    case 'task': return <ProjectsWindow key={`task:${route.taskId}`} webQuery={{ taskId: route.taskId }} />;
    case 'event': return <CalendarWindow webQuery={{ event: route.eventId, view: 'day' }} />;
    default: return <NotMounted label="This Ledger route" />;
  }
};
