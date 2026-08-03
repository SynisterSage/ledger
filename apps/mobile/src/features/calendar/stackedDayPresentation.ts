import type { MobileCalendarItem, MobileCalendarItemType } from './calendarItemNormalizer';

export type StackedDayStrip = {
  id: string;
  color: string;
  category: MobileCalendarItemType;
};

export type StackedDayPresentation = {
  totalCount: number;
  visibleStrips: StackedDayStrip[];
  overflowCount: number;
  categorySummary: string;
  sourceCount: number;
};

const MAX_VISIBLE_STRIPS = 3;
const categoryRank: Record<MobileCalendarItemType, number> = {
  event: 0,
  external_event: 0,
  reminder: 2,
  task: 3,
  project_action: 3,
  milestone: 4,
  project_deadline: 4,
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

function eventRank(item: MobileCalendarItem) {
  if (item.type === 'event' || item.type === 'external_event') return item.allDay || !item.startAt ? 0 : 1;
  return categoryRank[item.type];
}

export function getStackedDayPresentation(items: MobileCalendarItem[], fallbackColor: string): StackedDayPresentation {
  const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];
  if (!uniqueItems.length) return { totalCount: 0, visibleStrips: [], overflowCount: 0, categorySummary: '', sourceCount: 0 };

  const ordered = uniqueItems
    .map((item, index) => ({ item, index }))
    .sort((left, right) => eventRank(left.item) - eventRank(right.item)
      || (left.item.startAt ?? '').localeCompare(right.item.startAt ?? '')
      || left.index - right.index
      || left.item.id.localeCompare(right.item.id))
    .map(({ item }) => item);
  const counts = new Map<string, number>();
  const sources = new Set<string>();
  for (const item of ordered) {
    const label = categoryLabels[item.type];
    counts.set(label, (counts.get(label) ?? 0) + 1);
    sources.add(item.sourceKey ?? item.sourceName ?? item.sourceId ?? item.type);
  }
  return {
    totalCount: ordered.length,
    visibleStrips: ordered.slice(0, MAX_VISIBLE_STRIPS).map((item) => ({ id: item.id, color: item.sourceColor ?? fallbackColor, category: item.type })),
    overflowCount: Math.max(0, ordered.length - MAX_VISIBLE_STRIPS),
    categorySummary: [...counts.entries()].map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`).join(', '),
    sourceCount: sources.size,
  };
}
