import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMobileCalendarRange } from '@/api/calendar';
import { filterCalendarItems, type CalendarFilters } from './calendarFilters';
import type { CalendarItemsByDate, MobileCalendarItem } from './calendarItemNormalizer';
import { normalizeCalendarRange, sortCalendarItems } from './calendarItemNormalizer';
import { subscribeCalendarDataChanges } from './calendarDataEvents';

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
    setIsLoading(true);
    setError(null);

    void getMobileCalendarRange(workspaceId, startDate, endDate)
      .then((payload) => {
        if (cancelled) return;
        setItems(sortCalendarItems(normalizeCalendarRange(payload)));
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
    if (changedWorkspaceId === workspaceId) setRetryToken((value) => value + 1);
  }), [workspaceId]);

  const visibleItems = useMemo(() => filters ? filterCalendarItems(items, filters) : items, [filters, items]);
  const itemsByDate = useMemo<CalendarItemsByDate>(() => visibleItems.reduce<CalendarItemsByDate>((groups, item) => {
    (groups[item.dateKey] ??= []).push(item);
    return groups;
  }, {}), [visibleItems]);
  const retry = useCallback(() => setRetryToken((value) => value + 1), []);

  return { items: visibleItems, itemsByDate, isLoading, error, retry };
}
