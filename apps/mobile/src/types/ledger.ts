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
  timeLabel?: string | null;
  urgency?: string | null;
};

export type MobileCaptureItem = {
  id: string;
  title: string;
  source: string;
  workspaceId: string;
  workspaceName: string | null;
  createdAt: string | null;
};

export type MobileCaptureSummary = {
  count: number;
  items: MobileCaptureItem[];
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

export type MobileTodayInteractionItem = MobileUpcomingItem | MobileTodayItem | MobileCaptureItem;

export type MobileTodayResponse = {
  date: string;
  scope: MobileTodayScope;
  upcoming: MobileUpcomingItem[];
  today: MobileTodayItem[];
  captures: MobileCaptureSummary;
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
