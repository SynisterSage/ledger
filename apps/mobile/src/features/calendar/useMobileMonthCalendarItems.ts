import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMobileCalendarMonth } from '@/api/calendar';
import { filterCalendarItems, type CalendarFilters } from './calendarFilters';
import type { CalendarItemsByDate, MobileCalendarItem } from './calendarItemNormalizer';
import { sortCalendarItems } from './calendarItemNormalizer';
import { subscribeCalendarDataChanges } from './calendarDataEvents';

const MONTH_RANGE_CACHE_TTL_MS = 30_000;
const monthRangeCache = new Map<string, { items: MobileCalendarItem[]; cachedAt: number }>();

/**
 * Month owns one range request for the same months that its list renders.
 * There is deliberately no "currently selected day" request here: every
 * mounted cell must be able to read its item bucket without selecting it.
 */
export function useMobileMonthCalendarItems(
  workspaceId: string,
  startDate: string,
  endDate: string,
  filters?: CalendarFilters,
  enabled = true,
) {
  const [items, setItems] = useState<MobileCalendarItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(true);
      return;
    }
    let cancelled = false;
    const cacheKey = `${workspaceId}:${startDate}:${endDate}`;
    const cached = monthRangeCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < MONTH_RANGE_CACHE_TTL_MS) {
      setItems(cached.items);
      setError(null);
      setIsLoading(false);
      return () => { cancelled = true; };
    }

    setIsLoading(true);
    setError(null);

    void getMobileCalendarMonth(workspaceId, startDate, endDate)
      .then((payload) => {
        if (cancelled) return;
        const nextItems = sortCalendarItems(payload.items ?? []);
        monthRangeCache.set(cacheKey, { items: nextItems, cachedAt: Date.now() });
        setItems(nextItems);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : 'Month items could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled, endDate, retryToken, startDate, workspaceId]);

  useEffect(() => subscribeCalendarDataChanges((changedWorkspaceId) => {
    if (changedWorkspaceId !== workspaceId) return;
    for (const key of monthRangeCache.keys()) {
      if (key.startsWith(`${workspaceId}:`)) monthRangeCache.delete(key);
    }
    setRetryToken((value) => value + 1);
  }), [workspaceId]);

  const visibleItems = useMemo(() => filters ? filterCalendarItems(items, filters) : items, [filters, items]);
  const itemsByDate = useMemo<CalendarItemsByDate>(() => visibleItems.reduce<CalendarItemsByDate>((groups, item) => {
    (groups[item.dateKey] ??= []).push(item);
    return groups;
  }, {}), [visibleItems]);
  const retry = useCallback(() => {
    monthRangeCache.delete(`${workspaceId}:${startDate}:${endDate}`);
    setRetryToken((value) => value + 1);
  }, [endDate, startDate, workspaceId]);

  return { items: visibleItems, itemsByDate, isLoading, error, retry };
}
