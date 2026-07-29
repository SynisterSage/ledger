import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type AppleReminderList = {
  id: string;
  title: string;
  sourceTitle: string;
  sourceId?: string;
  color: string;
  allowsContentModifications?: boolean;
  visible: boolean;
  available: boolean;
};

export type AppleReminder = {
  id: string;
  title: string;
  remind_at: string;
  all_day?: boolean;
  calendar_id: string;
  color?: string;
  is_done: boolean;
  priority?: number;
  notes?: string | null;
  recurrence_rule?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  provider?: 'apple-reminders';
  provider_list_name?: string;
  provider_reminder_id?: string;
  provider_last_modified?: string | null;
};

type SavedState = { connected: boolean; lists: AppleReminderList[] };
const stateKey = (userId: string) => `ledger.apple-reminders.${userId}`;
const supportedOnMac = () => Boolean(window.appleReminders) && /Macintosh|Mac OS X/.test(navigator.userAgent);

const readState = (userId: string): SavedState => {
  try {
    const parsed = JSON.parse(localStorage.getItem(stateKey(userId)) ?? 'null');
    return parsed && Array.isArray(parsed.lists) ? parsed : { connected: false, lists: [] };
  } catch { return { connected: false, lists: [] }; }
};

const recurrenceName = (value: unknown) => ({ 0: 'daily', 1: 'weekly', 2: 'monthly', 3: 'yearly' } as Record<number, AppleReminder['recurrence_rule']>)[Number(value)] ?? 'none';

export const mapAppleReminder = (item: Record<string, unknown>): AppleReminder => ({
  id: `apple-reminder:${String(item.id)}`,
  title: String(item.title ?? 'Untitled reminder'),
  remind_at: String(item.dueAt),
  all_day: Boolean(item.allDay),
  calendar_id: `apple-reminder:${String(item.listId)}`,
  color: String(item.listColor ?? '#F59E0B'),
  is_done: Boolean(item.completed),
  priority: Number(item.priority ?? 0),
  notes: item.notes ? String(item.notes) : null,
  recurrence_rule: item.recurrence ? recurrenceName((item.recurrence as Record<string, unknown>).frequency) : 'none',
  provider: 'apple-reminders',
  provider_list_name: String(item.listTitle ?? ''),
  provider_reminder_id: String(item.id),
  provider_last_modified: item.lastModified ? String(item.lastModified) : null,
});

export const useAppleReminders = (userId: string | undefined, start: Date, end: Date) => {
  const supported = supportedOnMac();
  const [state, setState] = useState<SavedState>(() => userId ? readState(userId) : { connected: false, lists: [] });
  const [permission, setPermission] = useState('not_requested');
  const [availableLists, setAvailableLists] = useState<AppleReminderList[]>([]);
  const [reminders, setReminders] = useState<AppleReminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const refreshLists = useCallback(async () => {
    if (!supported || !window.appleReminders) return [] as AppleReminderList[];
    const response = await window.appleReminders.getLists();
    if (!response.ok) throw new Error(response.error || 'Could not load Apple reminder lists.');
    const saved = userId ? readState(userId) : { connected: false, lists: [] };
    const savedById = new Map(saved.lists.map((item) => [item.id, item]));
    const next = ((response.lists ?? []) as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id), title: String(item.title ?? 'Untitled list'), sourceTitle: String(item.sourceTitle ?? 'Apple Reminders'), sourceId: item.sourceId ? String(item.sourceId) : undefined,
      color: String(item.color ?? '#94A3B8'), allowsContentModifications: Boolean(item.allowsContentModifications), visible: savedById.get(String(item.id))?.visible !== false, available: true,
    }));
    const unavailable = saved.lists.filter((item) => !next.some((candidate) => candidate.id === item.id)).map((item) => ({ ...item, available: false }));
    const merged = [...next, ...unavailable];
    setAvailableLists(merged);
    return merged;
  }, [supported, userId]);

  const connect = useCallback(async () => {
    if (!supported || !window.appleReminders) return;
    setLoading(true); setError(null);
    try {
      let status = await window.appleReminders.getPermissionStatus();
      setPermission(status.status);
      if (status.status === 'not_requested') {
        await window.appleReminders.requestAccess();
        status = await window.appleReminders.getPermissionStatus();
        setPermission(status.status);
      }
      if (status.status === 'granted') await refreshLists();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not connect Apple Reminders.'); }
    finally { setLoading(false); }
  }, [refreshLists, supported]);

  const saveSelection = useCallback((selected: AppleReminderList[]) => {
    if (!userId) return;
    const next = { connected: selected.length > 0, lists: selected.map((item) => ({ ...item, visible: item.visible !== false, available: true })) };
    localStorage.setItem(stateKey(userId), JSON.stringify(next));
    setState(next); setAvailableLists(next.lists);
  }, [userId]);

  const setListVisible = useCallback((id: string, visible: boolean) => {
    if (!userId) return;
    const next = { ...state, lists: state.lists.map((item) => item.id === id ? { ...item, visible } : item) };
    localStorage.setItem(stateKey(userId), JSON.stringify(next)); setState(next);
  }, [state, userId]);

  const loadReminders = useCallback(async (broadcast = false) => {
    const requestId = ++requestIdRef.current;
    if (!supported || !window.appleReminders || !state.connected) { setReminders([]); return; }
    const listIds = state.lists.filter((item) => item.visible !== false && item.available).map((item) => item.id);
    if (!listIds.length) { setReminders([]); return; }
    setSyncStatus('syncing');
    const status = await window.appleReminders.getConnectionStatus();
    setPermission(status.status);
    if (status.status !== 'granted') { setReminders([]); setSyncStatus('error'); setError('Ledger can’t access Apple Reminders. Allow access in macOS System Settings to reconnect.'); return; }
    const response = await window.appleReminders.refresh({ start: new Date(start.getTime() - 86400000).toISOString(), end: new Date(end.getTime() + 86400000).toISOString(), listIds });
    if (!response.ok) throw new Error(response.error || 'Could not load Apple Reminders.');
    if (requestId !== requestIdRef.current) return;
    setReminders(((response.reminders ?? []) as Array<Record<string, unknown>>).filter((item) => item.id && item.dueAt).map(mapAppleReminder));
    setSyncStatus('synced');
    if (broadcast) window.ipcRenderer?.send('calendar:items-updated');
  }, [end, start, state, supported]);

  useEffect(() => { if (userId) setState(readState(userId)); }, [userId]);
  useEffect(() => { if (state.connected) void loadReminders().catch((err) => { setSyncStatus('error'); setError(err instanceof Error ? err.message : 'Could not load Apple Reminders.'); }); else setReminders([]); }, [loadReminders, state.connected]);
  useEffect(() => {
    if (!supported || !window.appleCalendar) return;
    const unsubscribe = window.appleCalendar.onChanged(() => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => { void loadReminders(true).catch((err) => setError(err instanceof Error ? err.message : 'Could not refresh Apple Reminders.')); }, 250);
    });
    return () => { unsubscribe(); if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [loadReminders, supported]);
  useEffect(() => { const refresh = () => { if (document.visibilityState === 'visible') void loadReminders(true); }; window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [loadReminders]);

  const connectedLists = useMemo(() => state.lists.map((item) => ({ ...item, id: `apple-reminder:${item.id}` })), [state.lists]);
  const callReminderKit = useCallback(async (command: 'createReminder' | 'updateReminder' | 'setCompleted' | 'moveReminder' | 'deleteReminder', payload: Record<string, unknown>) => {
    if (!supported || !window.appleReminders) throw new Error('Apple Reminders is only available in the macOS app.');
    const response = await window.appleReminders[command](payload as never) as { ok: boolean; reminder?: Record<string, unknown>; error?: string; notFound?: boolean };
    if (!response.ok) throw Object.assign(new Error(response.error || 'Ledger couldn’t save this reminder to Apple Reminders.'), { notFound: response.notFound });
    if (response.reminder) {
      const mapped = mapAppleReminder(response.reminder);
      setReminders((current) => [...current.filter((item) => item.provider_reminder_id !== mapped.provider_reminder_id), mapped]);
      await loadReminders(true);
      return mapped;
    }
    await loadReminders(true);
    return response;
  }, [loadReminders, supported]);
  const refetchReminder = useCallback(async (reminderId: string) => {
    if (!supported || !window.appleReminders) throw new Error('Apple Reminders is unavailable.');
    const response = await window.appleReminders.getReminder({ reminderId });
    if (!response.ok || !response.reminder) throw Object.assign(new Error(response.error || 'This Apple reminder is no longer available.'), { notFound: response.notFound });
    return mapAppleReminder(response.reminder as Record<string, unknown>);
  }, [supported]);
  return { supported, connected: state.connected, permission, lists: availableLists, connectedLists, reminders, loading, syncStatus, error, connect, refreshLists, saveSelection, setListVisible, refreshReminders: loadReminders, refetchReminder, createReminder: (payload: Record<string, unknown>) => callReminderKit('createReminder', payload), updateReminder: (payload: Record<string, unknown>) => callReminderKit('updateReminder', payload), setCompleted: (payload: Record<string, unknown>) => callReminderKit('setCompleted', payload), moveReminder: (payload: Record<string, unknown>) => callReminderKit('moveReminder', payload), deleteReminder: (payload: Record<string, unknown>) => callReminderKit('deleteReminder', payload), disconnect: () => { if (!userId) return; const next = { connected: false, lists: [] }; localStorage.setItem(stateKey(userId), JSON.stringify(next)); setState(next); setReminders([]); } };
};
