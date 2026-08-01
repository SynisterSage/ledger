import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultCalendarFilters, type CalendarFilters } from './calendarFilters';
import * as SecureStore from 'expo-secure-store';

export type MobileCalendarView = 'month' | 'agenda' | 'day' | 'week';

export type CalendarViewContext = {
  workspaceId: string;
  selectedDate: Date;
  visiblePeriod: Date;
  filters: CalendarFilters;
  onSelectDate: (date: Date) => void;
  onChangeVisiblePeriod: (date: Date) => void;
};

const CALENDAR_VIEW_STORAGE_KEY = 'ledger-mobile-calendar-view';
const CALENDAR_FILTER_STORAGE_KEY = 'ledger-mobile-calendar-filters';

function readFilters(workspaceId: string): CalendarFilters {
  try {
    const value = globalThis.localStorage?.getItem(`${CALENDAR_FILTER_STORAGE_KEY}:${workspaceId}`);
    if (!value) return defaultCalendarFilters;
    return { ...defaultCalendarFilters, ...JSON.parse(value) };
  } catch { return defaultCalendarFilters; }
}

function persistFilters(workspaceId: string, filters: CalendarFilters) {
  try { globalThis.localStorage?.setItem(`${CALENDAR_FILTER_STORAGE_KEY}:${workspaceId}`, JSON.stringify(filters)); } catch { /* best effort */ }
  void SecureStore.setItemAsync(`${CALENDAR_FILTER_STORAGE_KEY}:${workspaceId}`, JSON.stringify(filters)).catch(() => undefined);
}

function readInitialView(): MobileCalendarView {
  try {
    const storage = (globalThis as { localStorage?: { getItem: (key: string) => string | null } }).localStorage;
    const value = storage?.getItem(CALENDAR_VIEW_STORAGE_KEY);
    if (value === 'month' || value === 'agenda' || value === 'day' || value === 'week') return value;
  } catch {
    // Local preferences are best effort on native platforms.
  }
  return 'month';
}

function persistView(view: MobileCalendarView) {
  try {
    const storage = (globalThis as { localStorage?: { setItem: (key: string, value: string) => void } }).localStorage;
    storage?.setItem(CALENDAR_VIEW_STORAGE_KEY, view);
  } catch {
    // Local preferences are best effort on native platforms.
  }
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + amount);
  return next;
}

export function useMobileCalendarState(workspaceId = 'default') {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [view, setViewState] = useState<MobileCalendarView>(readInitialView);
  const [selectedDate, setSelectedDate] = useState(today);
  const [visiblePeriod, setVisiblePeriod] = useState(today);
  const workspaceDatesRef = useRef<Record<string, { selectedDate: Date; visiblePeriod: Date }>>({});
  const activeWorkspaceRef = useRef(workspaceId);
  const [filters, setFiltersState] = useState<CalendarFilters>(() => readFilters(workspaceId));
  const [viewSheetOpen, setViewSheetOpen] = useState(false);
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);
  const [creationSheetOpen, setCreationSheetOpen] = useState(false);

  useEffect(() => {
    if (activeWorkspaceRef.current === workspaceId) return;
    workspaceDatesRef.current[activeWorkspaceRef.current] = { selectedDate, visiblePeriod };
    const saved = workspaceDatesRef.current[workspaceId];
    setSelectedDate(saved?.selectedDate ?? today);
    setVisiblePeriod(saved?.visiblePeriod ?? today);
    setFiltersState(readFilters(workspaceId));
    activeWorkspaceRef.current = workspaceId;
  }, [selectedDate, today, visiblePeriod, workspaceId]);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(`${CALENDAR_FILTER_STORAGE_KEY}:${workspaceId}`).then((value) => {
      if (!active || !value) return;
      try { setFiltersState({ ...defaultCalendarFilters, ...JSON.parse(value) }); } catch { /* ignore malformed preference */ }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [workspaceId]);

  const setFilters = useCallback((next: Partial<CalendarFilters> | CalendarFilters) => {
    setFiltersState((current) => {
      const resolved = { ...current, ...next };
      persistFilters(activeWorkspaceRef.current, resolved);
      return resolved;
    });
  }, []);

  const resetFilters = useCallback(() => {
    persistFilters(activeWorkspaceRef.current, defaultCalendarFilters);
    setFiltersState(defaultCalendarFilters);
  }, []);

  const setView = useCallback((nextView: MobileCalendarView) => {
    setViewState(nextView);
    persistView(nextView);
  }, []);

  const selectDate = useCallback((date: Date) => {
    const next = startOfDay(date);
    setSelectedDate(next);
    workspaceDatesRef.current[activeWorkspaceRef.current] = { selectedDate: next, visiblePeriod };
  }, [visiblePeriod]);

  const changeVisiblePeriod = useCallback((date: Date) => setVisiblePeriod(startOfDay(date)), []);

  const goToToday = useCallback(() => {
    const next = startOfDay(new Date());
    setSelectedDate(next);
    setVisiblePeriod(next);
  }, []);

  const movePeriod = useCallback((amount: number) => {
    const next = view === 'month'
      ? addMonths(visiblePeriod, amount)
      : addDays(visiblePeriod, amount * (view === 'week' ? 7 : 1));
    setVisiblePeriod(next);
    setSelectedDate(next);
  }, [view, visiblePeriod]);

  return {
    view,
    selectedDate,
    visiblePeriod,
    filters,
    setFilters,
    resetFilters,
    viewSheetOpen,
    sourceSheetOpen,
    creationSheetOpen,
    setView,
    selectDate,
    changeVisiblePeriod,
    goToToday,
    goToPreviousPeriod: () => movePeriod(-1),
    goToNextPeriod: () => movePeriod(1),
    setViewSheetOpen,
    setSourceSheetOpen,
    setCreationSheetOpen,
  };
}
