type PreloadableModule =
  | 'calendar'
  | 'circle'
  | 'files'
  | 'inbox'
  | 'notifications'
  | 'notes'
  | 'projects'
  | 'settings'
  | 'slack'
  | 'teams';

const moduleLoaders: Record<PreloadableModule, () => Promise<unknown>> = {
  calendar: () => import('../components/Calendar/CalendarWindow'),
  circle: () => import('../components/Circle/CircleWindow'),
  files: () => import('../components/Files/FilesWindow'),
  inbox: () => import('../components/Inbox/InboxWindow'),
  notifications: () => import('../components/Notifications/NotificationCenterWindow'),
  notes: () => import('../components/Notes/NotesWindow'),
  projects: () => import('../components/Projects/ProjectsWindow'),
  settings: () => import('../components/Settings/SettingsWindow'),
  slack: () => import('../components/Slack/SlackWindow'),
  teams: () => import('../components/Teams/TeamsWindow'),
};

const preloadedModules = new Set<PreloadableModule>();

export const preloadLedgerModule = (module: string) => {
  if (!(module in moduleLoaders)) return;
  const key = module as PreloadableModule;
  if (preloadedModules.has(key)) return;
  preloadedModules.add(key);
  void moduleLoaders[key]().catch(() => {
    // The lazy boundary will retry the import when the module is opened.
    preloadedModules.delete(key);
  });
};
