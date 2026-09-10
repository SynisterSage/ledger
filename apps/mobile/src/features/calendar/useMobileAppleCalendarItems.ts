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

function normalizeEvents(events: AppleCalendarEvent[], workspaceId: string): MobileCalendarItem[] {
  return events.flatMap((event) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
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
        title: event.title,
        dateKey,
        startAt: multiDay ? null : event.start,
        endAt: multiDay ? null : event.end,
        allDay: event.allDay || multiDay,
        sourceId: event.id,
        sourceName: event.calendarTitle,
        sourceColor: event.calendarColor,
        sourceKey: `apple-calendar:${event.calendarId}`,
        sourceKind: 'calendar',
        calendarId: `apple:${event.calendarId}`,
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
      // A newly granted connection has no saved selection. Include every
      // calendar by default so subscribed calendars such as Holidays appear.
      const calendarIds = validSelectedIds.length > 0 || stored ? validSelectedIds : availableIds;
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
        if (!cancelled) setItems(normalizeEvents(events, workspaceId));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void refresh().catch(() => { if (!cancelled) setItems([]); });
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
