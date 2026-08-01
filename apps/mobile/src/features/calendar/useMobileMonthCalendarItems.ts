import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMobileCalendarRange, type MobileCalendarRangeResponse } from '@/api/calendar';
import { generateCalendarMonth } from './calendarMonthGenerator';
import { filterCalendarItems, type CalendarFilters } from './calendarFilters';
import type { CalendarItemsByDate, MobileCalendarItem } from './calendarItemNormalizer';
import { normalizeCalendarRange, sortCalendarItems } from './calendarItemNormalizer';

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
    void getMobileCalendarRange(workspaceId, monthRange.startDate, monthRange.endDate)
      .then((payload: MobileCalendarRangeResponse) => {
        if (cancelled) return;
        setItems(sortCalendarItems(normalizeCalendarRange(payload)));
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
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
