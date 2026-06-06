export type Workspace = {
  id: string;
  name: string;
  isDefault?: boolean;
  role?: 'owner' | 'admin' | 'member' | 'viewer';
};

export type TodayItem = {
  id: string;
  title: string;
  meta: string;
};

export type TodayGroup = {
  workspace: Workspace;
  items: TodayItem[];
};

export type MobileTodayScope = {
  workspaceId: string;
  label: string;
};

export type MobileUpcomingItem = {
  id: string;
  type: 'event' | 'reminder' | 'task' | 'deadline';
  title: string;
  workspaceId: string;
  workspaceName: string | null;
  timeLabel: string | null;
  dateLabel?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: 'upcoming';
  sourceType: 'calendar_event' | 'reminder' | 'task' | 'project';
  sourceId: string;
};

export type MobileTodayItem = {
  id: string;
  type: 'focus' | 'task' | 'reminder' | 'project_action' | 'event';
  title: string;
  workspaceId: string;
  workspaceName: string | null;
  meta: string;
  dueLabel: string;
  status: 'active' | 'overdue';
  sourceType: 'task' | 'reminder' | 'project_action' | 'calendar_event';
  sourceId: string;
  startsAt?: string | null;
  endsAt?: string | null;
  timeLabel?: string | null;
  dateLabel?: string | null;
  urgency?: string | null;
};

export type MobileCaptureItem = {
  id: string;
  title: string;
  source: string;
  workspaceId: string;
  workspaceName: string | null;
  createdAt: string | null;
  dateLabel?: string | null;
};

export type MobileCaptureSummary = {
  count: number;
  items: MobileCaptureItem[];
};

export type MobileTodayNoteItem = {
  id: string;
  type: 'note';
  title: string;
  workspaceId: string;
  workspaceName: string | null;
  sourceType: 'note';
  sourceId: string;
  body: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

export type MobileProjectOption = {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  completeness?: number | null;
  color?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type MobileTodayInteractionItem = MobileUpcomingItem | MobileTodayItem | MobileCaptureItem | MobileTodayNoteItem;

export type MobileTodayResponse = {
  date: string;
  scope: MobileTodayScope;
  upcoming: MobileUpcomingItem[];
  today: MobileTodayItem[];
  captures: MobileCaptureSummary;
  notes: MobileTodayNoteItem[];
};

export type MobileWorkspaceScopeOption = {
  id: string;
  name: string;
  subtitle?: string;
  type: 'scope' | 'personal' | 'workspace';
  role?: 'owner' | 'admin' | 'member' | 'viewer';
  isDefault?: boolean;
};

export type CaptureType = 'reminder' | 'task' | 'event' | 'note' | 'project-action';

export type CaptureRoute =
  | '/capture/reminder'
  | '/capture/task'
  | '/capture/event'
  | '/capture/note'
  | '/capture/project-action';

export type CaptureOption = {
  id: CaptureType;
  title: string;
  subtitle: string;
  href: CaptureRoute;
};

export type NotificationItem = {
  id: string;
  title: string;
  workspace: Workspace;
  meta: string;
  actions: string[];
};

export type MobileNotificationCenterItem = {
  id: string;
  sourceType: 'reminder' | 'event' | 'task' | 'project' | 'inbox' | 'workspace_invite';
  sourceId: string;
  notificationType: string | null;
  title: string;
  body: string | null;
  context: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceColor: string | null;
  moduleKind: string | null;
  actions: string[];
  scheduledFor: string | null;
  deliveredInAppAt: string | null;
  deliveredDesktopAt: string | null;
  dismissedAt: string | null;
  actionTaken: string | null;
  status: 'active' | 'earlier';
};

export type MobileNotificationCenterResponse = {
  active: MobileNotificationCenterItem[];
  earlier: MobileNotificationCenterItem[];
  counts: {
    active: number;
    earlier: number;
    total: number;
  };
};

export type MobileSearchResult = {
  id: string;
  type: 'note' | 'project' | 'task' | 'reminder' | 'event';
  title: string;
  preview: string;
  snippet: string | null;
  workspace_id: string;
  workspace_name: string | null;
  source_type: string | null;
  source_id: string | null;
  project_id?: string | null;
  note_id?: string | null;
  remind_at?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  updated_at?: string | null;
  icon?: string | null;
  score?: number;
};
