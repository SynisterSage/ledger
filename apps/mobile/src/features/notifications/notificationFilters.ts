import type { MobileNotificationCenterItem } from '@/types/ledger';

export type NotificationSemantic = 'events' | 'reminders' | 'tasks' | 'captures' | 'projects' | 'invites';

export type NotificationFilterState = {
  semantics: NotificationSemantic[];
};

export const DEFAULT_NOTIFICATION_FILTERS: NotificationFilterState = { semantics: [] };

export const NOTIFICATION_SEMANTICS: Array<[NotificationSemantic, string]> = [
  ['events', 'Events'],
  ['reminders', 'Reminders'],
  ['tasks', 'Tasks'],
  ['captures', 'Captures'],
  ['projects', 'Projects'],
  ['invites', 'Invites'],
];

function semanticForNotification(item: MobileNotificationCenterItem): NotificationSemantic {
  switch (item.sourceType) {
    case 'event': return 'events';
    case 'reminder': return 'reminders';
    case 'task': return 'tasks';
    case 'inbox': return 'captures';
    case 'project': return 'projects';
    case 'workspace_invite': return 'invites';
  }
}

export function filterNotifications(items: MobileNotificationCenterItem[], filters: NotificationFilterState) {
  if (!filters.semantics.length) return items;
  return items.filter((item) => filters.semantics.includes(semanticForNotification(item)));
}

export function countActiveNotificationFilters(filters: NotificationFilterState) {
  return filters.semantics.length;
}
