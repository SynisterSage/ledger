import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMobileCalendarMonth, type MobileCalendarMonthItem } from '@/api/calendar';
import { generateCalendarMonth } from './calendarMonthGenerator';
import { filterCalendarItems, type CalendarFilters } from './calendarFilters';
import type { CalendarItemsByDate, MobileCalendarItem, MobileCalendarItemType } from './calendarItemNormalizer';

function toCalendarItem(item: MobileCalendarMonthItem): MobileCalendarItem | null {
  const allowedTypes: MobileCalendarItemType[] = ['event', 'external_event', 'reminder', 'task', 'project_action', 'project_deadline', 'milestone'];
  if (!item.id || !item.title || !item.dateKey || !allowedTypes.includes(item.type as MobileCalendarItemType)) return null;
  return { ...item, type: item.type as MobileCalendarItemType };
}

export function useMobileMonthCalendarItems(workspaceId: string, monthDate: Date, filters?: CalendarFilters) {
  const monthRange = useMemo(() => {
    const month = generateCalendarMonth(monthDate, monthDate);
    const firstDay = month.weeks[0]?.[0]?.dateKey ?? `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-01`;
    const lastWeek = month.weeks[month.weeks.length - 1];
    const lastDay = lastWeek?.[lastWeek.length - 1]?.dateKey ?? firstDay;
    return { startDate: firstDay, endDate: lastDay };
  }, [monthDate]);
  const [items, setItems] = useState<MobileCalendarItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setError(null);
    setIsLoading(true);
    void getMobileCalendarMonth(workspaceId, monthRange.startDate, monthRange.endDate)
      .then((payload) => {
        if (cancelled) return;
        const nextItems = payload.items.map(toCalendarItem).filter((item): item is MobileCalendarItem => Boolean(item));
        console.log('[mobile-calendar-month-client]', {
          workspaceId,
          startDate: monthRange.startDate,
          endDate: monthRange.endDate,
          received: payload.items.length,
          normalized: nextItems.length,
          dates: nextItems.map((item) => item.dateKey),
        });
        setItems(nextItems);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          console.error('[mobile-calendar-month-client]', nextError);
          setError(nextError instanceof Error ? nextError.message : 'Month items could not be loaded.');
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [monthRange.endDate, monthRange.startDate, retryToken, workspaceId]);

  const visibleItems = useMemo(() => filters ? filterCalendarItems(items, filters) : items, [filters, items]);
  const itemsByDate = useMemo<CalendarItemsByDate>(() => visibleItems.reduce<CalendarItemsByDate>((groups, item) => {
    (groups[item.dateKey] ??= []).push(item);
    return groups;
  }, {}), [visibleItems]);
  const retry = useCallback(() => setRetryToken((value) => value + 1), []);
  return { items: visibleItems, itemsByDate, isLoading, error, retry, range: monthRange };
}
