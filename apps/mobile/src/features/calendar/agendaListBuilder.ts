import { formatCalendarDateKey } from './calendarMonthGenerator';
import type { MobileCalendarItem } from './calendarItemNormalizer';

export type AgendaListEntry =
  | { type: 'date_header'; dateKey: string }
  | { type: 'group_header'; id: string; label: string }
  | { type: 'item'; item: MobileCalendarItem };

const isPast = (item: MobileCalendarItem) => {
  if (item.completed) return true;
  if (item.endAt && !item.allDay) return new Date(item.endAt).getTime() < Date.now();
  return Boolean(item.overdue);
};

const isCurrent = (item: MobileCalendarItem) => {
  if (!item.startAt || !item.endAt || item.allDay) return false;
  const now = Date.now();
  return new Date(item.startAt).getTime() <= now && new Date(item.endAt).getTime() >= now;
};

const groupRank = (item: MobileCalendarItem) => {
  if (item.completed || isPast(item)) return 7;
  if (isCurrent(item)) return 0;
  if ((item.type === 'event' || item.type === 'external_event') && item.allDay) return 1;
  if ((item.type === 'event' || item.type === 'external_event' || item.type === 'reminder') && item.startAt && !item.allDay) return 2;
  if (item.type === 'reminder') return 3;
  if (item.type === 'task' || item.type === 'project_action') return 4;
  return 5;
};

export function dateLabel(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }).replace(',', ' ·');
}

export function buildAgendaListEntries(items: MobileCalendarItem[], selectedDate: Date) {
  const itemsByDate = new Map<string, MobileCalendarItem[]>();
  for (const item of items) {
    const bucket = itemsByDate.get(item.dateKey) ?? [];
    bucket.push(item);
    itemsByDate.set(item.dateKey, bucket);
  }

  const selectedKey = formatCalendarDateKey(selectedDate);
  if (!itemsByDate.has(selectedKey)) itemsByDate.set(selectedKey, []);
  const todayKey = formatCalendarDateKey(new Date());
  if (!itemsByDate.has(todayKey)) itemsByDate.set(todayKey, []);

  const entries: AgendaListEntry[] = [];
  const dateKeys = Array.from(itemsByDate.keys()).sort();
  for (const dateKey of dateKeys) {
    entries.push({ type: 'date_header', dateKey });
    const dateItems = itemsByDate.get(dateKey) ?? [];
    const sorted = [...dateItems].sort((left, right) => {
      const rankDifference = groupRank(left) - groupRank(right);
      return rankDifference || (left.startAt ?? '').localeCompare(right.startAt ?? '') || left.title.localeCompare(right.title);
    });
    for (const item of sorted) {
      entries.push({ type: 'item', item });
    }
  }
  return { entries, dateLabel };
}
