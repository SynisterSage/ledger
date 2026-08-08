import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type AppleCalendar = {
  id: string;
  title: string;
  sourceTitle: string;
  sourceId?: string;
  type?: number;
  color: string;
  allowsContentModifications?: boolean;
  visible: boolean;
  available: boolean;
};

export type AppleEvent = {
  id: string;
  calendar_id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day?: boolean;
  color?: string;
  notes?: string | null;
  url?: string | null;
  location?: string | null;
  provider?: 'apple';
  provider_calendar_name?: string;
  provider_event_id?: string;
  provider_last_modified?: string | null;
  time_zone?: string | null;
  recurrence?: unknown;
  recurrence_rule?: string;
  status?: 'planned' | 'cancelled';
  visibility?: 'private';
};

export const mapAppleEvent = (item: Record<string, unknown>): AppleEvent => ({
  id: `apple-event:${String(item.id)}`,
  calendar_id: `apple:${String(item.calendarId)}`,
  title: String(item.title ?? 'Untitled event'),
  start_at: String(item.start),
  end_at: String(item.end),
  all_day: Boolean(item.allDay),
  color: String(item.calendarColor ?? '#94A3B8'),
  notes: item.notes ? String(item.notes) : null,
  url: item.url ? String(item.url) : null,
  location: item.location ? String(item.location) : null,
  provider: 'apple',
  provider_calendar_name: String(item.calendarTitle ?? ''),
  provider_event_id: String(item.id),
  provider_last_modified: item.lastModified ? String(item.lastModified) : null,
  time_zone: item.timeZone ? String(item.timeZone) : null,
  recurrence: item.recurrence,
  recurrence_rule: item.recurrence ? ({ 0: 'daily', 1: 'weekly', 2: 'monthly', 3: 'yearly' } as Record<number, string>)[Number((item.recurrence as Record<string, unknown>).frequency)] ?? 'none' : 'none',
  status: Number(item.status ?? 0) === 3 ? 'cancelled' : 'planned',
  visibility: 'private',
});

type SavedState = { connected: boolean; calendars: AppleCalendar[] };
const stateKey = (userId: string) => `ledger.apple-calendar.${userId}`;
const isAppleDesktop = () => Boolean(window.appleCalendar) && /Macintosh|Mac OS X/.test(navigator.userAgent);

const readState = (userId: string): SavedState => {
  try {
    const parsed = JSON.parse(localStorage.getItem(stateKey(userId)) ?? 'null');
    return parsed && Array.isArray(parsed.calendars) ? parsed : { connected: false, calendars: [] };
  } catch { return { connected: false, calendars: [] }; }
};

const writeState = (userId: string, state: SavedState) => localStorage.setItem(stateKey(userId), JSON.stringify(state));

export const useAppleCalendar = (userId: string | undefined, start: Date, end: Date) => {
  const supported = isAppleDesktop();
  const [state, setState] = useState<SavedState>(() => userId ? readState(userId) : { connected: false, calendars: [] });
  const [permission, setPermission] = useState('not_requested');
  const [availableCalendars, setAvailableCalendars] = useState<AppleCalendar[]>([]);
  const [events, setEvents] = useState<AppleEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);

  const refreshCalendars = useCallback(async () => {
    if (!supported || !window.appleCalendar) return [] as AppleCalendar[];
    const response = await window.appleCalendar.listCalendars();
    if (!response.ok) throw new Error(response.error || 'Could not load Apple calendars.');
    const saved = userId ? readState(userId) : { connected: false, calendars: [] };
    const savedById = new Map(saved.calendars.map((item) => [item.id, item]));
    const next = ((response.calendars ?? []) as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id), title: String(item.title ?? 'Untitled calendar'), sourceTitle: String(item.sourceTitle ?? 'Apple Calendar'), sourceId: item.sourceId ? String(item.sourceId) : undefined,
      type: Number(item.type ?? 0), color: String(item.color ?? '#94A3B8'), allowsContentModifications: Boolean(item.allowsContentModifications), visible: savedById.get(String(item.id))?.visible !== false, available: true,
    }));
    const unavailable = saved.calendars.filter((item) => !next.some((candidate) => candidate.id === item.id)).map((item) => ({ ...item, available: false }));
    setAvailableCalendars([...next, ...unavailable]);
    return [...next, ...unavailable];
  }, [supported, userId]);

  const requestAccessAndList = useCallback(async () => {
    if (!supported || !window.appleCalendar) return false;
    setLoading(true); setError(null);
    try {
      let status = await window.appleCalendar.status();
      setPermission(status.status);
      if (status.status === 'not_requested') {
        await window.appleCalendar.requestAccess();
        status = await window.appleCalendar.status();
        setPermission(status.status);
      }
      if (status.status !== 'granted') return false;
      await refreshCalendars();
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not connect Apple Calendar.'); }
    finally { setLoading(false); }
    return false;
  }, [refreshCalendars, supported]);

  const saveSelection = useCallback((selected: AppleCalendar[]) => {
    if (!userId) return;
    const next = { connected: selected.length > 0, calendars: selected.map((item) => ({ ...item, visible: item.visible !== false, available: true })) };
    writeState(userId, next); setState(next); setAvailableCalendars(next.calendars);
  }, [userId]);

  const setCalendarVisible = useCallback((id: string, visible: boolean) => {
    if (!userId) return;
    const next = { ...state, calendars: state.calendars.map((item) => item.id === id ? { ...item, visible } : item) };
    writeState(userId, next); setState(next);
  }, [state, userId]);

  const loadEvents = useCallback(async (broadcast = false) => {
    const requestId = ++requestIdRef.current;
    if (!supported || !window.appleCalendar || !state.connected) { setEvents([]); return; }
    const selected = state.calendars.filter((item) => item.visible !== false && item.available).map((item) => item.id);
    if (!selected.length) { setEvents([]); return; }
    setSyncStatus('syncing');
    const status = await window.appleCalendar.connectionStatus();
    setPermission(status.status);
    if (status.status !== 'granted') { setEvents([]); setSyncStatus('error'); setError('Ledger can’t access Apple Calendar. Restore access in macOS System Settings.'); return; }
    const bufferedStart = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const bufferedEnd = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    const response = await window.appleCalendar.refreshRange({ start: bufferedStart.toISOString(), end: bufferedEnd.toISOString(), calendarIds: selected });
    if (!response.ok) throw new Error(response.error || 'Could not load Apple Calendar events.');
    if (requestId !== requestIdRef.current) return;
    setEvents(((response.events ?? []) as Array<Record<string, unknown>>).filter((item) => item.id).map(mapAppleEvent));
    setSyncStatus('synced');
    if (broadcast) window.ledgerIpc?.commands?.calendarItemsUpdated();
  }, [end, start, state, supported]);

  useEffect(() => { if (userId) setState(readState(userId)); }, [userId]);
  useEffect(() => { if (state.connected) void loadEvents().catch((err) => { setSyncStatus('error'); setError(err instanceof Error ? err.message : 'Could not load Apple Calendar events.'); }); else setEvents([]); }, [loadEvents, state.connected]);
  useEffect(() => {
    if (!supported || !window.appleCalendar) return;
    const unsubscribe = window.appleCalendar.onChanged(() => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(() => { void loadEvents(true).catch((err) => { setSyncStatus('error'); setError(err instanceof Error ? err.message : 'Could not refresh Apple Calendar.'); }); }, 250);
    });
    return () => { unsubscribe(); if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current); };
  }, [loadEvents, supported]);
  useEffect(() => { const refresh = () => { if (document.visibilityState === 'visible') void loadEvents(true); }; window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [loadEvents]);

  const connectedCalendars = useMemo(() => state.calendars.map((item) => ({ ...item, id: `apple:${item.id}` })), [state.calendars]);
  const callEventKit = useCallback(async (command: 'createEvent' | 'updateEvent' | 'deleteEvent' | 'moveEvent', payload: Record<string, unknown>) => {
    if (!supported || !window.appleCalendar) throw new Error('Apple Calendar is only available in the macOS app.');
    if (command === 'createEvent' && (!String(payload.title ?? '').trim() || !String(payload.calendarId ?? '').trim())) throw new Error('Choose an Apple calendar and enter an event title.');
    const response = await window.appleCalendar[command](payload as never) as { ok: boolean; event?: Record<string, unknown>; error?: string; notFound?: boolean };
    if (!response.ok) throw Object.assign(new Error(response.error || 'Ledger could not save this event to Apple Calendar.'), { notFound: response.notFound });
    return response.event ? mapAppleEvent(response.event) : response;
  }, [supported]);
  const refetchEvent = useCallback(async (eventId: string) => {
    if (!supported || !window.appleCalendar) throw new Error('Apple Calendar is unavailable.');
    const response = await window.appleCalendar.getEvent({ eventId });
    if (!response.ok || !response.event) throw Object.assign(new Error(response.error || 'This Apple Calendar event is no longer available.'), { notFound: response.notFound });
    return mapAppleEvent(response.event as Record<string, unknown>);
  }, [supported]);
  return { supported, connected: state.connected, permission, calendars: availableCalendars, connectedCalendars, events, loading, syncStatus, error, refreshEvents: loadEvents, connect: requestAccessAndList, refreshCalendars, saveSelection, setCalendarVisible, refetchEvent, createEvent: (payload: Record<string, unknown>) => callEventKit('createEvent', payload), updateEvent: (payload: Record<string, unknown>) => callEventKit('updateEvent', payload), deleteEvent: (payload: Record<string, unknown>) => callEventKit('deleteEvent', payload), moveEvent: (payload: Record<string, unknown>) => callEventKit('moveEvent', payload), disconnect: () => { if (!userId) return; const next = { connected: false, calendars: [] }; writeState(userId, next); setState(next); setEvents([]); } };
};
