import type { MobileCalendarItem, MobileCalendarItemType } from './calendarItemNormalizer';

export type CalendarFilters = {
  visibleCalendarIds: string[];
  visibleReminderListIds: string[];
  showEvents: boolean;
  showReminders: boolean;
  showTasks: boolean;
  showProjectActions: boolean;
  showMilestones: boolean;
  showProjectDeadlines: boolean;
};

export const defaultCalendarFilters: CalendarFilters = {
  visibleCalendarIds: [],
  visibleReminderListIds: [],
  showEvents: true,
  showReminders: true,
  showTasks: true,
  showProjectActions: true,
  showMilestones: true,
  showProjectDeadlines: true,
};

const typeFilter: Record<MobileCalendarItemType, keyof CalendarFilters | null> = {
  event: 'showEvents',
  external_event: 'showEvents',
  reminder: 'showReminders',
  task: 'showTasks',
  project_action: 'showProjectActions',
  milestone: 'showMilestones',
  project_deadline: 'showProjectDeadlines',
};

export function isCalendarItemVisible(item: MobileCalendarItem, filters: CalendarFilters) {
  const key = typeFilter[item.type];
  if (key && filters[key] !== true) return false;
  if (item.sourceKind === 'reminder' && filters.visibleReminderListIds.length > 0 && item.sourceKey && !filters.visibleReminderListIds.includes(item.sourceKey)) return false;
  if (item.sourceKind === 'calendar' && filters.visibleCalendarIds.length > 0 && item.sourceKey && !filters.visibleCalendarIds.includes(item.sourceKey)) return false;
  return true;
}

export function filterCalendarItems(items: MobileCalendarItem[], filters: CalendarFilters) {
  return items.filter((item) => isCalendarItemVisible(item, filters));
}

export function mergeCalendarFilters(current: CalendarFilters, patch: Partial<CalendarFilters>): CalendarFilters {
  return { ...current, ...patch };
}
