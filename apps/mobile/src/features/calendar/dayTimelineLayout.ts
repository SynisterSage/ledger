import type { MobileCalendarItem } from './calendarItemNormalizer';

export type PositionedDayItem = {
  item: MobileCalendarItem;
  top: number;
  height: number;
  column: number;
  columnCount: number;
};

export const MIN_TIMED_ITEM_MINUTES = 15;

export function getDayMinutes(value: string | null | undefined, fallback = 0) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.getHours() * 60 + date.getMinutes();
}

export function getTimedItemMinutes(item: MobileCalendarItem) {
  const start = getDayMinutes(item.startAt, 0);
  const end = item.endAt ? getDayMinutes(item.endAt, start + MIN_TIMED_ITEM_MINUTES) : start + MIN_TIMED_ITEM_MINUTES;
  return { start, end: Math.max(start + MIN_TIMED_ITEM_MINUTES, end) };
}

export function positionDayItems(items: MobileCalendarItem[], hourHeight: number): PositionedDayItem[] {
  const sorted = items
    .filter((item) => Boolean(item.startAt) && !item.allDay)
    .map((item) => ({ item, ...getTimedItemMinutes(item) }))
    .sort((left, right) => left.start - right.start || left.end - right.end || left.item.title.localeCompare(right.item.title));
  const positioned: PositionedDayItem[] = [];
  let cluster: typeof sorted = [];

  const flushCluster = () => {
    if (!cluster.length) return;
    const columns: typeof sorted[] = [];
    for (const entry of cluster) {
      let column = columns.findIndex((columnItems) => columnItems[columnItems.length - 1].end <= entry.start);
      if (column < 0) {
        column = columns.length;
        columns.push([]);
      }
      columns[column].push(entry);
    }
    const columnCount = columns.length;
    columns.forEach((columnItems, column) => columnItems.forEach((entry) => positioned.push({
      item: entry.item,
      top: (entry.start / 60) * hourHeight,
      height: Math.max(34, ((entry.end - entry.start) / 60) * hourHeight),
      column,
      columnCount,
    })));
    cluster = [];
  };

  for (const entry of sorted) {
    const clusterEnd = cluster.reduce((maximum, current) => Math.max(maximum, current.end), -1);
    if (cluster.length && entry.start >= clusterEnd) flushCluster();
    cluster.push(entry);
  }
  flushCluster();
  return positioned.sort((left, right) => left.top - right.top || left.column - right.column);
}
