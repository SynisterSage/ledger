import type { MobileCalendarItem, MobileCalendarItemType } from './calendarItemNormalizer';

export type CompactDayMarker = {
  color: string;
  strength: 'dot' | 'capsule';
};

export type CompactDayPresentation = {
  totalCount: number;
  markers: CompactDayMarker[];
  categorySummary: string;
};

const priority: Record<MobileCalendarItemType, number> = {
  event: 0,
  external_event: 0,
  reminder: 1,
  task: 1,
  project_action: 1,
  milestone: 2,
  project_deadline: 2,
};

const categoryLabels: Record<MobileCalendarItemType, string> = {
  event: 'event',
  external_event: 'event',
  reminder: 'reminder',
  task: 'task',
  project_action: 'project action',
  milestone: 'milestone',
  project_deadline: 'deadline',
};

export function getCompactDayPresentation(items: MobileCalendarItem[], fallbackColor: string): CompactDayPresentation {
  if (!items.length) return { totalCount: 0, markers: [], categorySummary: '' };

  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => priority[left.item.type] - priority[right.item.type] || left.index - right.index)
    .map(({ item }) => item);
  const markers = ordered.slice(0, 3).map((item) => ({
    color: item.sourceColor ?? fallbackColor,
    strength: items.length === 1 ? 'dot' as const : 'capsule' as const,
  }));
  const counts = new Map<string, number>();
  for (const item of ordered) {
    const label = categoryLabels[item.type];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const categorySummary = [...counts.entries()].map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`).join(' and ');
  return { totalCount: items.length, markers, categorySummary };
}
