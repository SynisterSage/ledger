import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { appleCalendarNative, type AppleCalendarEvent } from '@/native/appleCalendar';
import { formatCalendarDateKey } from './calendarMonthGenerator';
import type { MobileCalendarItem } from './calendarItemNormalizer';
import { subscribeCalendarDataChanges } from './calendarDataEvents';

const selectionKey = (userId?: string | null) => userId ? `ledger.apple-calendar.selection.${userId}` : null;

function localDateBoundary(dateKey: string, end = false) {
  const date = new Date(`${dateKey}T${end ? '23:59:59.999' : '00:00:00'}`);
  return date.toISOString();
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function parseAppleDate(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeAppleCalendarEvents(events: AppleCalendarEvent[], workspaceId: string): MobileCalendarItem[] {
  return events.flatMap((event) => {
    // Be tolerant of Expo clients that bridge native dates as epoch values.
    // A malformed optional end should not discard an otherwise valid event.
    const start = parseAppleDate(event.start);
    const end = parseAppleDate(event.end) ?? start;
    if (!start || !end) return [];
    const firstDate = formatCalendarDateKey(start);
    const lastDate = event.allDay && end > start
      ? formatCalendarDateKey(addDays(end, -1))
      : formatCalendarDateKey(end);
    const items: MobileCalendarItem[] = [];
    let cursor = new Date(`${firstDate}T12:00:00`);
    let occurrence = 0;
    while (formatCalendarDateKey(cursor) <= lastDate && occurrence < 32) {
      const dateKey = formatCalendarDateKey(cursor);
      const multiDay = dateKey !== firstDate || lastDate !== firstDate;
      items.push({
        id: `apple-event:${event.id}:${dateKey}`,
        type: 'external_event',
        title: String(event.title || 'Untitled event'),
        dateKey,
        startAt: multiDay ? null : start.toISOString(),
        endAt: multiDay ? null : end.toISOString(),
        allDay: event.allDay || multiDay,
        sourceId: String(event.id),
        sourceName: String(event.calendarTitle || 'Apple Calendar'),
        sourceColor: event.calendarColor || null,
        sourceKey: `apple-calendar:${String(event.calendarId)}`,
        sourceKind: 'calendar',
        calendarId: `apple:${String(event.calendarId)}`,
        workspaceId,
        readOnly: true,
        notes: event.notes ?? null,
        location: event.location ?? null,
        status: event.status === 3 ? 'cancelled' : 'planned',
        sourcePlatform: 'apple',
      });
      cursor = addDays(cursor, 1);
      occurrence += 1;
    }
    return items;
  });
}

export function useMobileAppleCalendarItems(
  workspaceId: string,
  userId: string | null | undefined,
  startDate: string,
  endDate: string,
) {
  const [items, setItems] = useState<MobileCalendarItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!appleCalendarNative.supported || !userId) {
      setItems([]);
      return;
    }
    const storedSelectionKey = selectionKey(userId);
    if (!storedSelectionKey) return;
    let cancelled = false;
    const refresh = async () => {
      const status = await appleCalendarNative.getAuthorizationStatus();
      if (__DEV__) console.log('[Ledger Apple Calendar] access', { supported: appleCalendarNative.supported, status, startDate, endDate });
      if (status !== 'granted') {
        if (!cancelled) setItems([]);
        return;
      }
      const availableCalendars = await appleCalendarNative.listCalendars();
      const stored = await SecureStore.getItemAsync(storedSelectionKey);
      let selectedIds: string[] = [];
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) selectedIds = parsed.map(String);
        } catch {
          selectedIds = [];
        }
      }
      const availableIds = availableCalendars.map((calendar) => calendar.id);
      const validSelectedIds = selectedIds.filter((id) => availableIds.includes(id));
      // Use every available calendar when the saved selection is empty or
      // stale. This keeps a granted connection from silently showing nothing.
      const calendarIds = validSelectedIds.length > 0 ? validSelectedIds : availableIds;
      if (__DEV__) console.log('[Ledger Apple Calendar] calendars', { available: availableCalendars.map((calendar) => ({ id: calendar.id, title: calendar.title, type: calendar.type })), selectedIds, calendarIds });
      if (calendarIds.length === 0) {
        if (!cancelled) setItems([]);
        return;
      }
      if (!cancelled) setIsLoading(true);
      try {
        const events = await appleCalendarNative.fetchEvents(
          localDateBoundary(startDate),
          localDateBoundary(endDate, true),
          calendarIds,
        );
        const normalized = normalizeAppleCalendarEvents(events, workspaceId);
        if (__DEV__) console.log('[Ledger Apple Calendar] events', {
          count: events.length,
          normalized: normalized.length,
          dropped: events.length - new Set(normalized.map((item) => item.sourceId)).size,
          sample: events[0] ? { start: events[0].start, end: events[0].end, allDay: events[0].allDay } : null,
          startDate,
          endDate,
        });
        if (!cancelled) setItems(normalized);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void refresh().catch((error: unknown) => {
      if (__DEV__) console.warn('[Ledger Apple Calendar] refresh failed', error);
      if (!cancelled) setItems([]);
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh().catch(() => undefined);
    });
    const unsubscribe = subscribeCalendarDataChanges((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) setRefreshToken((current) => current + 1);
    });
    return () => {
      cancelled = true;
      subscription.remove();
      unsubscribe();
    };
  }, [endDate, refreshToken, startDate, userId, workspaceId]);

  return { items, isLoading };
}
