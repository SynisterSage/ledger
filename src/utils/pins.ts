export type PinObjectType =
  | 'person'
  | 'project'
  | 'note'
  | 'team'
  | 'task'
  | 'event'
  | 'reminder'
  | 'saved_view'
  | 'follow_up_view'
  | 'team_page';

export type PinDestinationKind =
  | 'circle'
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'teams'
  | 'dashboard'
  | 'notifications'
  | 'settings'
  | 'inbox'
  | 'quick-follow-up'
  | 'quick-task'
  | 'quick-note'
  | 'quick-event';

export type PinDestination = {
  kind: PinDestinationKind;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};

export type PinFolder = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  sort_order: number;
  collapsed: boolean;
  created_at: string;
  updated_at: string;
};

export type PinRecord = {
  id: string;
  workspace_id: string;
  user_id: string;
  object_type: PinObjectType;
  object_id: string;
  folder_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  title: string;
  subtitle?: string | null;
  icon_kind: 'person' | 'project' | 'note' | 'team' | 'task' | 'event' | 'reminder';
  initials?: string | null;
  color?: string | null;
  destination: PinDestination;
};

export type WorkspaceRoute = {
  kind: PinDestinationKind | null;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};

export type PinNavigationTarget = {
  module: 'circle' | 'calendar' | 'notes' | 'projects' | 'teams' | 'dashboard';
  focus: WorkspaceRoute;
  openInNewWindow?: boolean;
};

export const isRouteMatchingPin = (route: WorkspaceRoute | null | undefined, pin: PinRecord) => {
  if (!route?.kind) return false;

  switch (pin.object_type) {
    case 'person':
      return route.kind === 'circle' && String(route.focusContext ?? '').startsWith(`ledger-person|${pin.object_id}|`);
    case 'project':
      return route.kind === 'projects' && route.focusProjectId === pin.object_id;
    case 'note':
      return route.kind === 'notes' && route.focusNoteId === pin.object_id;
    case 'team':
    case 'team_page':
      return route.kind === 'teams' && route.focusContext === `team:${pin.object_id}`;
    case 'task':
      return route.kind === 'dashboard' && route.focusTaskId === pin.object_id;
    case 'event':
      return route.kind === 'calendar' && route.focusContext === `focus-event:${pin.object_id}`;
    case 'reminder':
      return route.kind === 'calendar' && route.focusContext === `focus-reminder:${pin.object_id}`;
    case 'saved_view':
    case 'follow_up_view':
      return false;
    default:
      return false;
  }
};

export const getPinNavigationTarget = (pin: PinRecord): PinNavigationTarget | null => {
  switch (pin.object_type) {
    case 'person':
      return {
        module: 'circle',
        focus: {
          kind: 'circle',
          focusContext: pin.destination.focusContext ?? `ledger-person|${pin.object_id}|${encodeURIComponent(pin.title ?? 'Person')}`,
        },
      };
    case 'project':
      return {
        module: 'projects',
        focus: {
          kind: 'projects',
          focusProjectId: pin.object_id,
        },
      };
    case 'note':
      return {
        module: 'notes',
        focus: {
          kind: 'notes',
          focusNoteId: pin.object_id,
        },
      };
    case 'team':
    case 'team_page':
      return {
        module: 'teams',
        focus: {
          kind: 'teams',
          focusContext: pin.destination.focusContext ?? `team:${pin.object_id}`,
        },
      };
    case 'task':
      return {
        module: 'dashboard',
        focus: {
          kind: 'dashboard',
          focusTaskId: pin.object_id,
        },
      };
    case 'event':
      return {
        module: 'calendar',
        focus: {
          kind: 'calendar',
          focusContext: `focus-event:${pin.object_id}`,
        },
        openInNewWindow: true,
      };
    case 'reminder':
      return {
        module: 'calendar',
        focus: {
          kind: 'calendar',
          focusContext: `focus-reminder:${pin.object_id}`,
        },
        openInNewWindow: true,
      };
    default:
      return null;
  }
};
