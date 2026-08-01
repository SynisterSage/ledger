import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getMobileCalendarRange, type MobileCalendarRangeResponse } from '@/api/calendar';
import { formatCalendarDateKey } from './calendarMonthGenerator';
import { normalizeCalendarRange, sortCalendarItems, type MobileCalendarItem } from './calendarItemNormalizer';

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function useMobileAgendaItems(workspaceId: string, anchorDate: Date) {
  const initialStart = useMemo(() => formatCalendarDateKey(addDays(startOfDay(anchorDate), -7)), [anchorDate]);
  const initialEnd = useMemo(() => formatCalendarDateKey(addDays(startOfDay(anchorDate), 30)), [anchorDate]);
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [items, setItems] = useState<MobileCalendarItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestIdRef = useRef(0);
  const cacheRef = useRef(new Map<string, MobileCalendarItem[]>());
  const previousWorkspaceIdRef = useRef(workspaceId);

  useEffect(() => {
    if (previousWorkspaceIdRef.current === workspaceId) return;
    previousWorkspaceIdRef.current = workspaceId;
    setItems([]);
    setStartDate(initialStart);
    setEndDate(initialEnd);
  }, [initialEnd, initialStart, workspaceId]);

  useFocusEffect(useCallback(() => {
    cacheRef.current.delete(`${workspaceId}:${startDate}:${endDate}`);
    setRefreshToken((current) => current + 1);
  }, [endDate, startDate, workspaceId]));

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    const cacheKey = `${workspaceId}:${startDate}:${endDate}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setItems(cached);
      return () => { cancelled = true; };
    }

    setIsLoading(true);
    setError(null);
    void getMobileCalendarRange(workspaceId, startDate, endDate)
      .then((payload: MobileCalendarRangeResponse) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        const nextItems = sortCalendarItems(normalizeCalendarRange(payload));
        cacheRef.current.set(cacheKey, nextItems);
        setItems(nextItems);
      })
      .catch((nextError: unknown) => {
        if (!cancelled && requestId === requestIdRef.current) setError(nextError instanceof Error ? nextError.message : 'Agenda could not be loaded.');
      })
      .finally(() => {
        if (!cancelled && requestId === requestIdRef.current) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [endDate, refreshToken, startDate, workspaceId]);

  const extendPast = useCallback(() => {
    const date = new Date(`${startDate}T12:00:00`);
    setStartDate(formatCalendarDateKey(addDays(date, -30)));
  }, [startDate]);

  const extendFuture = useCallback(() => {
    const date = new Date(`${endDate}T12:00:00`);
    setEndDate(formatCalendarDateKey(addDays(date, 60)));
  }, [endDate]);

  const retry = useCallback(() => {
    cacheRef.current.delete(`${workspaceId}:${startDate}:${endDate}`);
    setRefreshToken((current) => current + 1);
  }, [endDate, startDate, workspaceId]);

  return { items, startDate, endDate, isLoading, error, extendPast, extendFuture, retry };
}
