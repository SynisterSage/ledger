export type Workspace = {
  id: string;
  name: string;
  isDefault?: boolean;
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
