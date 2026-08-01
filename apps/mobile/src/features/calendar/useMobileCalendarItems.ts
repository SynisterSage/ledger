import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { getMobileCalendarRange, type MobileCalendarRangeResponse } from '@/api/calendar';
import { addCalendarMonths, formatCalendarDateKey, generateCalendarMonth } from './calendarMonthGenerator';
import { groupCalendarItems, normalizeCalendarRange, sortCalendarItems, type CalendarItemsByDate, type MobileCalendarItem } from './calendarItemNormalizer';
import { filterCalendarItems, type CalendarFilters } from './calendarFilters';

type RangeCacheEntry = {
  key: string;
  items: MobileCalendarItem[];
};

const sharedCalendarRangeCache = new Map<string, RangeCacheEntry>();

function formatRangeDate(date: Date) {
  return formatCalendarDateKey(date);
}

export function useMobileCalendarItems(workspaceId: string, visiblePeriod: Date, filters?: CalendarFilters) {
  const cacheRef = useRef(sharedCalendarRangeCache);
  const requestIdRef = useRef(0);
  const [items, setItems] = useState<MobileCalendarItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const previousWorkspaceIdRef = useRef(workspaceId);

  const range = useMemo(() => {
    const start = addCalendarMonths(visiblePeriod, -1);
    const end = addCalendarMonths(visiblePeriod, 2);
    const endMonth = generateCalendarMonth(end, end).date;
    endMonth.setMonth(endMonth.getMonth() + 1);
    endMonth.setDate(0);
    return { startDate: formatRangeDate(start), endDate: formatRangeDate(endMonth) };
  }, [visiblePeriod]);

  useFocusEffect(useCallback(() => {
    cacheRef.current.delete(`${workspaceId}:${range.startDate}:${range.endDate}`);
    setRefreshToken((current) => current + 1);
  }, [range.endDate, range.startDate, workspaceId]));

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    if (previousWorkspaceIdRef.current !== workspaceId) {
      previousWorkspaceIdRef.current = workspaceId;
      setItems([]);
    }
    const cacheKey = `${workspaceId}:${range.startDate}:${range.endDate}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setItems(cached.items);
      setError(null);
      return () => { cancelled = true; };
    }

    setIsLoading(true);
    setError(null);
    void getMobileCalendarRange(workspaceId, range.startDate, range.endDate)
      .then((payload: MobileCalendarRangeResponse) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        const normalized = normalizeCalendarRange(payload);
        const sorted = sortCalendarItems(normalized);
        cacheRef.current.set(cacheKey, { key: cacheKey, items: sorted });
        setItems(sorted);
      })
      .catch((nextError: unknown) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        const stale = [...cacheRef.current.values()].find((entry) => entry.key.startsWith(`${workspaceId}:`));
        if (stale) setItems(stale.items);
        setError(stale ? 'Calendar could not refresh. Showing cached items.' : nextError instanceof Error ? nextError.message : 'Calendar items could not be loaded.');
      })
      .finally(() => {
        if (!cancelled && requestId === requestIdRef.current) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [range.endDate, range.startDate, refreshToken, workspaceId]);

  const visibleItems = useMemo(() => filters ? filterCalendarItems(items, filters) : items, [filters, items]);
  const itemsByDate = useMemo<CalendarItemsByDate>(() => groupCalendarItems(visibleItems), [visibleItems]);

  return { items: visibleItems, allItems: items, itemsByDate, isLoading, error, retry: () => {
    cacheRef.current.delete(`${workspaceId}:${range.startDate}:${range.endDate}`);
    setItems([]);
    setError(null);
    setRefreshToken((current) => current + 1);
  }};
}
