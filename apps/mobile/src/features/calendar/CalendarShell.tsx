import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, InteractionManager, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/AppText';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { CalendarCreateSheet, CalendarSourcesSheet, CalendarViewSheet } from './CalendarSheets';
import { getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import { useAppPreferencesState } from '@/store/appPreferencesStore';
import { useLedgerTheme } from '@/theme';
import { mobileRequest } from '@/api/client';
import { createMeetingNoteFromCalendar } from '@/api/calendar';
import { deleteMobileEvent, deleteMobileReminder, deleteMobileTask, updateMobileEvent } from '@/api/captures';
import { useMobileCalendarState, type CalendarViewContext, type MobileCalendarView } from './useMobileCalendarState';
import { ContinuousMonthView, type ContinuousMonthViewHandle, type MonthScrollState } from './ContinuousMonthView';
import { AgendaView, type AgendaScrollState, type AgendaViewHandle } from './AgendaView';
import { DayView, type DayViewHandle } from './DayView';
import { LandscapeWeekView } from './LandscapeWeekView';
import { YearOverview } from './YearOverview';
import { MonthCalendarItemSheet } from './MonthCalendarItemSheet';
import type { MobileCalendarItem } from './calendarItemNormalizer';
import { calendarEditorParams } from './CalendarItemEditor';
import { formatCalendarDateKey } from './calendarMonthGenerator';
import { useFocusEffect } from 'expo-router';

const CALENDAR_PAGE_PADDING = 16;
const GLOBAL_TAB_BAR_HEIGHT = 52;
const GLOBAL_TAB_BAR_GAP = 10;
const CONTEXT_TOOLBAR_HEIGHT = 48;
const CONTEXT_TOOLBAR_GAP = 10;

function formatPeriodTitle(view: MobileCalendarView, date: Date) {
  if (view === 'year') return String(date.getFullYear());
  if (view === 'day') return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
  if (view === 'agenda') return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date);
  return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date);
}

function formatParentPeriod(view: MobileCalendarView, date: Date) {
  if (view === 'month') return String(date.getFullYear());
  return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date);
}

function PlaceholderView({ view, context }: { view: MobileCalendarView; context: CalendarViewContext }) {
  const theme = useLedgerTheme();
  const labels: Record<MobileCalendarView, string> = {
    year: 'Year overview is ready for calendar content.', month: 'Month view is ready for calendar content.', agenda: 'Agenda view is ready for calendar content.', day: 'Day view is ready for calendar content.',
  };
  return <View style={[styles.placeholder, { borderColor: theme.colors.borderSubtle }]}><SymbolView name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} size={24} tintColor={theme.colors.textMuted} /><AppText variant="meta" style={styles.placeholderText}>{labels[view]}</AppText><AppText variant="caption">{context.workspaceId === 'all' ? 'All workspaces' : 'Workspace calendar'}</AppText></View>;
}

function AnimatedPeriodTitle({ title, reduceMotion, style }: { title: string; reduceMotion: boolean; style?: object }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const previousTitle = useRef(title);

  useEffect(() => {
    const changed = previousTitle.current !== title;
    previousTitle.current = title;

    if (!changed || reduceMotion) {
      opacity.stopAnimation();
      translateY.stopAnimation();
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    opacity.stopAnimation();
    translateY.stopAnimation();
    opacity.setValue(0);
    translateY.setValue(4);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [opacity, reduceMotion, title, translateY]);

  return <Animated.View style={[styles.periodTitleAnimation, { opacity, transform: [{ translateY }] }]}><AppText variant="title" style={style}>{title}</AppText></Animated.View>;
}

export function CalendarShell() {
  const theme = useLedgerTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const insets = useSafeAreaInsets();
  const { reduceMotionEnabled } = useAppPreferencesState();
  const router = useRouter();
  const workspaceState = useWorkspaceState();
  const calendar = useMobileCalendarState(workspaceState.selectedWorkspaceId);
  // Landscape is an adaptive presentation of Day view. Keep the explicit
  // portrait Month/Week/Agenda/Year views intact when the device is rotated.
  const showLandscapeWeek = isLandscape && calendar.view === 'day';

  useEffect(() => {
    const screenOrientation = requireOptionalNativeModule<{
      lockAsync: (orientationLock: number) => Promise<void>;
    }>('ExpoScreenOrientation');
    if (!screenOrientation) return;

    // Only Day view is allowed to become the landscape weekly timeline.
    void screenOrientation.lockAsync(calendar.view === 'day' ? 0 : 3).catch(() => {
      // Ignore unsupported orientation policies on older/limited runtimes.
    });
  }, [calendar.view]);
  const [contentReady, setContentReady] = useState(false);
  const viewTransitionScale = useRef(new Animated.Value(1)).current;
  const viewTransitionOpacity = useRef(new Animated.Value(1)).current;
  const previousViewRef = useRef<MobileCalendarView>(calendar.view);
  useEffect(() => {
    let active = true;
    const task = InteractionManager.runAfterInteractions(() => {
      if (active) setContentReady(true);
    });
    return () => {
      active = false;
      task.cancel();
    };
  }, []);
  useEffect(() => {
    const previousView = previousViewRef.current;
    previousViewRef.current = calendar.view;
    const isYearMonthTransition = (previousView === 'year' && calendar.view === 'month') || (previousView === 'month' && calendar.view === 'year');
    if (!isYearMonthTransition || reduceMotionEnabled) {
      viewTransitionScale.stopAnimation();
      viewTransitionOpacity.stopAnimation();
      viewTransitionScale.setValue(1);
      viewTransitionOpacity.setValue(1);
      return;
    }

    const zoomIn = previousView === 'year' && calendar.view === 'month';
    viewTransitionScale.stopAnimation();
    viewTransitionOpacity.stopAnimation();
    viewTransitionScale.setValue(zoomIn ? 1.06 : 0.94);
    viewTransitionOpacity.setValue(0.94);
    Animated.parallel([
      Animated.timing(viewTransitionScale, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(viewTransitionOpacity, { toValue: 1, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [calendar.view, reduceMotionEnabled, viewTransitionOpacity, viewTransitionScale]);
  useFocusEffect(useCallback(() => {
    calendar.goToToday();
  }, [calendar.goToToday]));
  const monthViewRef = useRef<ContinuousMonthViewHandle>(null);
  const agendaViewRef = useRef<AgendaViewHandle>(null);
  const dayViewRef = useRef<DayViewHandle>(null);
  const [monthScrollStates, setMonthScrollStates] = useState<Record<string, MonthScrollState>>({});
  const [agendaScrollStates, setAgendaScrollStates] = useState<Record<string, AgendaScrollState>>({});
  const [dayScrollStates, setDayScrollStates] = useState<Record<string, Record<string, number>>>({});
  const [selectedCalendarItem, setSelectedCalendarItem] = useState<MobileCalendarItem | null>(null);
  const [calendarItemActionMode, setCalendarItemActionMode] = useState(false);
  const [dayCreateTimeMinutes, setDayCreateTimeMinutes] = useState<number | null>(null);
  const todayKey = formatCalendarDateKey(new Date());
  const isTodayRelevant = calendar.view === 'year'
    ? calendar.visiblePeriod.getFullYear() !== new Date().getFullYear()
    : calendar.view === 'month'
      ? formatCalendarDateKey(calendar.visiblePeriod).slice(0, 7) !== todayKey.slice(0, 7)
      : formatCalendarDateKey(calendar.selectedDate) !== todayKey;

  const handleToday = () => {
    const today = new Date();
    const currentView = calendar.view;
    calendar.goToToday();
    if (currentView === 'year') {
      calendar.setView('month');
      requestAnimationFrame(() => monthViewRef.current?.scrollToMonth(today));
    } else if (currentView === 'month') {
      monthViewRef.current?.scrollToToday();
    } else if (currentView === 'agenda') {
      agendaViewRef.current?.scrollToDate(today);
    } else if (currentView === 'day') {
      dayViewRef.current?.scrollToUsefulPosition();
    }
  };

  const changeCalendarView = (nextView: MobileCalendarView) => {
    calendar.setView(nextView);
    requestAnimationFrame(() => {
      if (nextView === 'agenda') agendaViewRef.current?.scrollToDate(calendar.selectedDate);
      if (nextView === 'month') monthViewRef.current?.scrollToMonth(calendar.selectedDate);
      if (nextView === 'day') dayViewRef.current?.scrollToUsefulPosition();
    });
  };

  const handleCalendarItemAction = async (actionId: string, item: MobileCalendarItem) => {
    const sourceId = item.sourceId ?? item.id.split(':')[1] ?? item.id;
    if (actionId === 'edit') {
      setSelectedCalendarItem(null);
      setCalendarItemActionMode(false);
      router.push({ pathname: '/calendar/editor', params: calendarEditorParams(item, workspaceState.selectedWorkspaceId) });
      return;
    }
    if (actionId === 'duplicate') {
      const duplicateType = item.type === 'external_event' ? 'event' : item.type;
      setSelectedCalendarItem(null);
      setCalendarItemActionMode(false);
      router.push({ pathname: '/calendar/editor', params: { mode: 'create', type: duplicateType, workspaceId: item.workspaceId, dateKey: item.dateKey, startAt: item.startAt ?? '', endAt: item.endAt ?? '', title: `${item.title} copy`, projectId: item.projectId ?? '', calendarId: item.calendarId ?? '', allDay: item.allDay ? '1' : '0' } });
      return;
    }
    if (actionId === 'reschedule') {
      setSelectedCalendarItem(null);
      setCalendarItemActionMode(false);
      router.push({ pathname: '/calendar/editor', params: { ...calendarEditorParams(item, workspaceState.selectedWorkspaceId), mode: 'edit' } });
      return;
    }
    if (actionId === 'meeting-note' && item.type === 'event') {
      try {
        await createMeetingNoteFromCalendar(item.workspaceId, { eventId: sourceId, provider: item.readOnly ? 'apple' : 'ledger', eventKey: sourceId, projectId: item.projectId });
        setSelectedCalendarItem(null);
        Alert.alert('Meeting notes ready', 'The event is now linked to a Ledger meeting note.');
      } catch (error) {
        Alert.alert('Could not start meeting notes', error instanceof Error ? error.message : 'Try again.');
      }
      return;
    }
    if (actionId === 'open-project' && item.projectId) {
      setSelectedCalendarItem(null);
      setCalendarItemActionMode(false);
      router.push({ pathname: '/project/[id]', params: { id: item.projectId } });
      return;
    }
    if (actionId === 'snooze' && item.type === 'reminder') {
      await mobileRequest(`/api/reminders/${encodeURIComponent(sourceId)}/snooze`, { method: 'POST', headers: { 'x-workspace-id': item.workspaceId }, body: JSON.stringify({ snooze_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() }) });
      setSelectedCalendarItem(null);
      return;
    }
    if (actionId === 'delete') {
      Alert.alert(`Delete ${item.type.replace('_', ' ')}?`, 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { void (item.type === 'event' || item.type === 'external_event' ? deleteMobileEvent(item.workspaceId, sourceId) : item.type === 'reminder' ? deleteMobileReminder(item.workspaceId, sourceId) : deleteMobileTask(item.workspaceId, sourceId)).then(() => { setSelectedCalendarItem(null); setCalendarItemActionMode(false); }); } }]);
      return;
    }
    const workspaceHeaders = { 'x-workspace-id': item.workspaceId };
    if (actionId === 'complete' && item.sourceId && item.type === 'reminder') {
      await mobileRequest(`/api/reminders/${encodeURIComponent(sourceId)}/complete`, { method: 'POST', headers: workspaceHeaders });
    } else if ((actionId === 'complete' || actionId === 'focus') && item.sourceId && (item.type === 'task' || item.type === 'project_action')) {
      await mobileRequest(`/api/tasks/${encodeURIComponent(sourceId)}`, { method: 'PATCH', headers: workspaceHeaders, body: JSON.stringify(actionId === 'focus' ? { show_in_today: true, is_today_focus: true } : { status: 'completed' }) });
    } else if (actionId === 'complete' && item.type === 'event') {
      await updateMobileEvent(item.workspaceId, sourceId, { status: item.completed ? 'planned' : 'done' });
    } else if (actionId === 'follow-up' && item.workspaceId) {
      await mobileRequest('/api/tasks', { method: 'POST', headers: workspaceHeaders, body: JSON.stringify({ title: `Follow up: ${item.title}`, due_date: item.dateKey, status: 'todo', priority: 'medium', project_id: item.projectId ?? null }) });
      Alert.alert('Follow-up created', 'The task was added to the selected date.');
    }
    setSelectedCalendarItem(null);
    setCalendarItemActionMode(false);
  };
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const workspaceLabel = useMemo(() => getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options), [workspaceState.options, workspaceState.selectedWorkspaceId]);
  const title = formatPeriodTitle(calendar.view, calendar.visiblePeriod);
  const viewContext: CalendarViewContext = {
    workspaceId: workspaceState.selectedWorkspaceId,
    selectedDate: calendar.selectedDate,
    visiblePeriod: calendar.visiblePeriod,
    filters: calendar.filters,
    onSelectDate: calendar.selectDate,
    onChangeVisiblePeriod: calendar.changeVisiblePeriod,
  };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
    >
    <View
      style={[styles.content, {
        paddingTop: showLandscapeWeek ? 0 : 12,
        paddingBottom: showLandscapeWeek ? 0 : GLOBAL_TAB_BAR_HEIGHT + GLOBAL_TAB_BAR_GAP + CONTEXT_TOOLBAR_HEIGHT + CONTEXT_TOOLBAR_GAP,
      }]}
    >
      <View style={[styles.toolbar, showLandscapeWeek && styles.landscapeHidden]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open year overview for ${calendar.visiblePeriod.getFullYear()}`} onPress={() => calendar.view === 'month' ? calendar.setView('year') : calendar.setView('month')} style={styles.parentButton}>
          <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={19} tintColor={theme.colors.textPrimary} /><AppText variant="bodyStrong">{calendar.view === 'year' ? formatPeriodTitle('year', calendar.visiblePeriod) : formatParentPeriod(calendar.view, calendar.visiblePeriod)}</AppText>
        </Pressable>
        <View style={styles.toolbarActions}>
          {calendar.view !== 'year' ? <Pressable accessibilityRole="button" accessibilityLabel={`Switch calendar view, current view ${calendar.view}`} onPress={() => calendar.setViewSheetOpen(true)} style={styles.iconTarget}><SymbolView name={{ ios: 'rectangle.3.group', android: 'view_module', web: 'view_module' }} size={21} tintColor={theme.colors.textPrimary} /></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Create calendar item" onPress={() => { setDayCreateTimeMinutes(null); calendar.setCreationSheetOpen(true); }} style={styles.iconTarget}><SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={23} tintColor={theme.colors.textPrimary} /></Pressable>
        </View>
      </View>

      <View style={[styles.periodHeader, showLandscapeWeek && styles.landscapeHidden]}>
        <AnimatedPeriodTitle title={title} reduceMotion={reduceMotionEnabled} style={calendar.view === 'year' ? styles.yearShellTitle : undefined} />
        <Pressable accessibilityRole="button" accessibilityLabel="Change workspace" onPress={() => setWorkspacePickerOpen(true)} style={styles.workspaceButton}><AppText variant="meta">{workspaceState.isLoading ? 'Loading workspace…' : workspaceLabel}</AppText><SymbolView name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={12} tintColor={theme.colors.textSecondary} /></Pressable>
      </View>

      <Animated.View style={[styles.viewArea, { opacity: viewTransitionOpacity, transform: [{ scale: viewTransitionScale }] }]}>
        {showLandscapeWeek ? (
          <LandscapeWeekView
            selectedDate={calendar.selectedDate}
            workspaceId={workspaceState.selectedWorkspaceId}
            filters={calendar.filters}
            scrollOffset={dayScrollStates[workspaceState.selectedWorkspaceId]?.[formatCalendarDateKey(calendar.selectedDate)]}
            onScrollOffsetChange={(offset) => setDayScrollStates((current) => ({ ...current, [workspaceState.selectedWorkspaceId]: { ...(current[workspaceState.selectedWorkspaceId] ?? {}), [formatCalendarDateKey(calendar.selectedDate)]: offset } }))}
            onSelectDate={(date) => { calendar.selectDate(date); calendar.changeVisiblePeriod(date); }}
            onOpenItem={(item) => { setCalendarItemActionMode(false); setSelectedCalendarItem(item); }}
            onLongPressItem={(item) => { setCalendarItemActionMode(true); setSelectedCalendarItem(item); }}
            onCreateAtTime={(date, minutes) => { calendar.selectDate(date); calendar.changeVisiblePeriod(date); setDayCreateTimeMinutes(minutes); calendar.setCreationSheetOpen(true); }}
            onBackToMonth={() => calendar.setView('month')}
            onChangeWeek={(amount) => { const next = new Date(calendar.selectedDate); next.setDate(next.getDate() + amount * 7); calendar.selectDate(next); calendar.changeVisiblePeriod(next); }}
            onOpenViewSheet={() => calendar.setViewSheetOpen(true)}
            onCreate={() => { setDayCreateTimeMinutes(null); calendar.setCreationSheetOpen(true); }}
          />
        ) : !contentReady ? <View style={[styles.contentLoading, { backgroundColor: theme.colors.surfaceMuted }]} /> : calendar.view === 'year' ? (
          <YearOverview
            visibleYear={calendar.visiblePeriod.getFullYear()}
            selectedDate={calendar.selectedDate}
            workspaceId={workspaceState.selectedWorkspaceId}
            filters={calendar.filters}
            onSelectMonth={(date) => { calendar.changeVisiblePeriod(date); calendar.setView('month'); requestAnimationFrame(() => monthViewRef.current?.scrollToMonth(date)); }}
            onSelectDate={(date) => { calendar.selectDate(date); calendar.changeVisiblePeriod(date); calendar.setView('month'); requestAnimationFrame(() => monthViewRef.current?.scrollToMonth(date)); }}
            onVisibleYearChange={(year) => calendar.changeVisiblePeriod(new Date(year, calendar.visiblePeriod.getMonth(), 1))}
          />
        ) : calendar.view === 'month' ? (
          <ContinuousMonthView
            ref={monthViewRef}
            selectedDate={calendar.selectedDate}
            visiblePeriod={calendar.visiblePeriod}
            workspaceId={workspaceState.selectedWorkspaceId}
            workspaceReady={workspaceState.isHydrated && !workspaceState.isLoading}
            filters={calendar.filters}
            scrollState={monthScrollStates[workspaceState.selectedWorkspaceId]}
            onSelectDate={(date) => { calendar.selectDate(date); calendar.changeVisiblePeriod(date); changeCalendarView('day'); }}
            onChangeVisiblePeriod={calendar.changeVisiblePeriod}
            onScrollStateChange={(state) => setMonthScrollStates((current) => ({ ...current, [workspaceState.selectedWorkspaceId]: state }))}
            onOpenItem={(item) => { setCalendarItemActionMode(false); setSelectedCalendarItem(item); }}
            onLongPressItem={(item) => { setCalendarItemActionMode(true); setSelectedCalendarItem(item); }}
            onCreateForDate={(date) => { calendar.selectDate(date); calendar.setCreationSheetOpen(true); }}
          />
        ) : calendar.view === 'agenda' ? (
          <AgendaView
            ref={agendaViewRef}
            selectedDate={calendar.selectedDate}
            workspaceId={workspaceState.selectedWorkspaceId}
            filters={calendar.filters}
            scrollState={agendaScrollStates[workspaceState.selectedWorkspaceId]}
            onSelectDate={calendar.selectDate}
            onChangeVisiblePeriod={calendar.changeVisiblePeriod}
            onScrollStateChange={(state) => setAgendaScrollStates((current) => ({ ...current, [workspaceState.selectedWorkspaceId]: state }))}
            onOpenItem={(item) => { setCalendarItemActionMode(false); setSelectedCalendarItem(item); }}
            onLongPressItem={(item) => { setCalendarItemActionMode(true); setSelectedCalendarItem(item); }}
            onCreateForDate={(date) => { calendar.selectDate(date); calendar.setCreationSheetOpen(true); }}
          />
        ) : calendar.view === 'day' ? (
          <DayView
            ref={dayViewRef}
            selectedDate={calendar.selectedDate}
            workspaceId={workspaceState.selectedWorkspaceId}
            filters={calendar.filters}
            scrollOffset={dayScrollStates[workspaceState.selectedWorkspaceId]?.[formatCalendarDateKey(calendar.selectedDate)]}
            onScrollOffsetChange={(offset) => setDayScrollStates((current) => ({ ...current, [workspaceState.selectedWorkspaceId]: { ...(current[workspaceState.selectedWorkspaceId] ?? {}), [formatCalendarDateKey(calendar.selectedDate)]: offset } }))}
            onSelectDate={(date) => { calendar.selectDate(date); calendar.changeVisiblePeriod(date); }}
            onOpenItem={(item) => { setCalendarItemActionMode(false); setSelectedCalendarItem(item); }}
            onLongPressItem={(item) => { setCalendarItemActionMode(true); setSelectedCalendarItem(item); }}
            onCreateAtTime={(date, minutes) => { calendar.selectDate(date); calendar.changeVisiblePeriod(date); setDayCreateTimeMinutes(minutes); calendar.setCreationSheetOpen(true); }}
          />
        ) : <PlaceholderView view={calendar.view} context={viewContext} />}
      </Animated.View>

    </View>

    {!isLandscape ? (
      <View
        style={[styles.contextToolbar, { bottom: insets.bottom + GLOBAL_TAB_BAR_HEIGHT + GLOBAL_TAB_BAR_GAP, backgroundColor: theme.colors.background, borderTopColor: theme.colors.borderSubtle }]}
      >
      <Pressable accessibilityRole="button" accessibilityLabel="Return to today" onPress={handleToday} style={({ pressed }) => [styles.contextAction, { opacity: pressed ? 0.65 : 1 }]}>
        <AppText variant="meta" style={{ color: isTodayRelevant ? theme.colors.accent : theme.colors.textSecondary }}>Today</AppText>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose visible calendars" onPress={() => calendar.setSourceSheetOpen(true)} style={({ pressed }) => [styles.contextAction, { opacity: pressed ? 0.65 : 1 }]}>
        <SymbolView name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} size={16} tintColor={theme.colors.textSecondary} />
        <AppText variant="meta">Calendars</AppText>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Open calendar inbox" onPress={() => router.push('/notifications')} style={({ pressed }) => [styles.contextAction, { opacity: pressed ? 0.65 : 1 }]}>
        <SymbolView name={{ ios: 'tray', android: 'inbox', web: 'inbox' }} size={16} tintColor={theme.colors.textSecondary} />
        <AppText variant="meta">Inbox</AppText>
      </Pressable>
      </View>
    ) : null}

    <MonthCalendarItemSheet
      visible={Boolean(selectedCalendarItem)}
      item={selectedCalendarItem}
      actionMode={calendarItemActionMode}
      workspaceLabel={workspaceLabel}
      onClose={() => { setSelectedCalendarItem(null); setCalendarItemActionMode(false); }}
      onAction={(actionId, item) => { void handleCalendarItemAction(actionId, item); }}
    />

    <CalendarViewSheet visible={calendar.viewSheetOpen} value={calendar.view} onChange={changeCalendarView} onClose={() => calendar.setViewSheetOpen(false)} />
    <CalendarCreateSheet
      visible={calendar.creationSheetOpen}
      workspaceId={workspaceState.selectedWorkspaceId}
      initialDateKey={formatCalendarDateKey(calendar.selectedDate)}
      initialStartAt={dayCreateTimeMinutes !== null ? (() => { const date = new Date(calendar.selectedDate); date.setHours(Math.floor(dayCreateTimeMinutes / 60), dayCreateTimeMinutes % 60, 0, 0); return date.toISOString(); })() : undefined}
      initialEndAt={dayCreateTimeMinutes !== null ? (() => { const date = new Date(calendar.selectedDate); date.setHours(Math.floor(dayCreateTimeMinutes / 60) + 1, dayCreateTimeMinutes % 60, 0, 0); return date.toISOString(); })() : undefined}
      onClose={() => { setDayCreateTimeMinutes(null); calendar.setCreationSheetOpen(false); }}
      onCreated={() => setDayCreateTimeMinutes(null)}
    />
    <CalendarSourcesSheet visible={calendar.sourceSheetOpen} workspaceId={workspaceState.selectedWorkspaceId} workspaceLabel={workspaceLabel} filters={calendar.filters} onChangeFilters={calendar.setFilters} onResetFilters={calendar.resetFilters} onOpenWorkspacePicker={() => { calendar.setSourceSheetOpen(false); setWorkspacePickerOpen(true); }} onManageConnection={() => { calendar.setSourceSheetOpen(false); router.push('/settings'); }} onClose={() => calendar.setSourceSheetOpen(false)} />
    <WorkspaceSelectorSheet visible={workspacePickerOpen} selectedWorkspaceId={workspaceState.selectedWorkspaceId} workspaces={workspaceState.options} onSelect={selectWorkspace} onClose={() => setWorkspacePickerOpen(false)} />
  </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, paddingHorizontal: CALENDAR_PAGE_PADDING, paddingTop: 12 },
  toolbar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  parentButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 2 },
  iconTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  periodHeader: { paddingTop: 14, paddingBottom: 18, gap: 5 },
  periodTitleAnimation: { alignSelf: 'flex-start' },
  workspaceButton: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  viewArea: { flex: 1 },
  contentLoading: { flex: 1, minHeight: 260, borderRadius: 8, opacity: 0.45 },
  placeholder: { flex: 1, minHeight: 260, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  placeholderText: { textAlign: 'center' },
  contextToolbar: { position: 'absolute', left: CALENDAR_PAGE_PADDING, right: CALENDAR_PAGE_PADDING, height: CONTEXT_TOOLBAR_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center' },
  contextAction: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 2 },
  yearShellTitle: { fontSize: 30, lineHeight: 38 },
  landscapeHidden: { display: 'none' },
});
