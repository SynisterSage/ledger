import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/AppText';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { CalendarCreateSheet, CalendarSourcesSheet, CalendarViewSheet } from './CalendarSheets';
import { useSearchSheet } from '@/features/search/SearchSheetContext';
import { getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { mobileRequest } from '@/api/client';
import { useMobileCalendarState, type CalendarViewContext, type MobileCalendarView } from './useMobileCalendarState';
import { ContinuousMonthView, type ContinuousMonthViewHandle, type MonthScrollState } from './ContinuousMonthView';
import { AgendaView, type AgendaScrollState, type AgendaViewHandle } from './AgendaView';
import { MonthCalendarItemSheet } from './MonthCalendarItemSheet';
import type { MobileCalendarItem } from './calendarItemNormalizer';

const CALENDAR_PAGE_PADDING = 16;

function formatPeriodTitle(view: MobileCalendarView, date: Date) {
  if (view === 'day') return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
  if (view === 'agenda') return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date);
  if (view === 'week') {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay() + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    return `${format.format(start)} – ${format.format(end)}`;
  }
  return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date);
}

function formatParentPeriod(view: MobileCalendarView, date: Date) {
  if (view === 'month') return String(date.getFullYear());
  return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date);
}

function PlaceholderView({ view, context }: { view: MobileCalendarView; context: CalendarViewContext }) {
  const theme = useLedgerTheme();
  const labels: Record<MobileCalendarView, string> = {
    month: 'Month view is ready for calendar content.', agenda: 'Agenda view is ready for calendar content.', day: 'Day view is ready for calendar content.', week: 'Week view is ready for calendar content.',
  };
  return <View style={[styles.placeholder, { borderColor: theme.colors.borderSubtle }]}><SymbolView name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} size={24} tintColor={theme.colors.textMuted} /><AppText variant="meta" style={styles.placeholderText}>{labels[view]}</AppText><AppText variant="caption">{context.workspaceId === 'all' ? 'All workspaces' : 'Workspace calendar'}</AppText></View>;
}

export function CalendarShell() {
  const theme = useLedgerTheme();
  const router = useRouter();
  const { openSearch } = useSearchSheet();
  const workspaceState = useWorkspaceState();
  const calendar = useMobileCalendarState(workspaceState.selectedWorkspaceId);
  const monthViewRef = useRef<ContinuousMonthViewHandle>(null);
  const agendaViewRef = useRef<AgendaViewHandle>(null);
  const [monthScrollStates, setMonthScrollStates] = useState<Record<string, MonthScrollState>>({});
  const [agendaScrollStates, setAgendaScrollStates] = useState<Record<string, AgendaScrollState>>({});
  const [selectedCalendarItem, setSelectedCalendarItem] = useState<MobileCalendarItem | null>(null);
  const [calendarItemActionMode, setCalendarItemActionMode] = useState(false);

  const changeCalendarView = (nextView: MobileCalendarView) => {
    calendar.setView(nextView);
    requestAnimationFrame(() => {
      if (nextView === 'agenda') agendaViewRef.current?.scrollToDate(calendar.selectedDate);
      if (nextView === 'month') monthViewRef.current?.scrollToMonth(calendar.selectedDate);
    });
  };

  const handleCalendarItemAction = async (actionId: string, item: MobileCalendarItem) => {
    const workspaceHeaders = { 'x-workspace-id': item.workspaceId };
    if (actionId === 'complete' && item.sourceId && item.type === 'reminder') {
      await mobileRequest(`/api/reminders/${encodeURIComponent(item.sourceId)}/complete`, { method: 'POST', headers: workspaceHeaders });
    } else if ((actionId === 'complete' || actionId === 'focus') && item.sourceId && (item.type === 'task' || item.type === 'project_action')) {
      await mobileRequest(`/api/tasks/${encodeURIComponent(item.sourceId)}`, { method: 'PATCH', headers: workspaceHeaders, body: JSON.stringify(actionId === 'focus' ? { show_in_today: true, is_today_focus: true } : { status: 'completed' }) });
    } else if (actionId === 'follow-up' && item.workspaceId) {
      await mobileRequest('/api/tasks', { method: 'POST', headers: workspaceHeaders, body: JSON.stringify({ title: `Follow up: ${item.title}`, due_date: item.dateKey, status: 'todo', priority: 'medium', project_id: item.projectId ?? null }) });
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

  const openCreateFlow = (href: '/capture/event' | '/capture/reminder' | '/capture/task' | '/capture/project-action') => {
    const selected = new Date(calendar.selectedDate);
    selected.setHours(11, 0, 0, 0);
    const dateInput = `${calendar.selectedDate.getFullYear()}-${String(calendar.selectedDate.getMonth() + 1).padStart(2, '0')}-${String(calendar.selectedDate.getDate()).padStart(2, '0')}`;
    const params = href === '/capture/event'
      ? { startsAt: selected.toISOString() }
      : href === '/capture/reminder'
        ? { dueAt: selected.toISOString() }
        : href === '/capture/task'
          ? { dueDate: dateInput }
          : {};
    calendar.setCreationSheetOpen(false);
    router.push({ pathname: href, params });
  };

  return <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.screen, { backgroundColor: theme.colors.background }]}>
    <View style={styles.content}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Return to ${formatParentPeriod(calendar.view, calendar.visiblePeriod)}`} onPress={() => Alert.alert('Year overview', 'The year overview will be available in a later calendar phase.')} style={styles.parentButton}>
          <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={19} tintColor={theme.colors.textPrimary} /><AppText variant="bodyStrong">{formatParentPeriod(calendar.view, calendar.visiblePeriod)}</AppText>
        </Pressable>
        <View style={styles.toolbarActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Switch calendar view, current view ${calendar.view}`} onPress={() => calendar.setViewSheetOpen(true)} style={styles.iconTarget}><SymbolView name={{ ios: 'rectangle.3.group', android: 'view_module', web: 'view_module' }} size={21} tintColor={theme.colors.textPrimary} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Search calendar" onPress={openSearch} style={styles.iconTarget}><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={21} tintColor={theme.colors.textPrimary} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Create calendar item" onPress={() => calendar.setCreationSheetOpen(true)} style={styles.iconTarget}><SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={23} tintColor={theme.colors.textPrimary} /></Pressable>
        </View>
      </View>

      <View style={styles.periodHeader}>
        <AppText variant="title">{title}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Change workspace" onPress={() => setWorkspacePickerOpen(true)} style={styles.workspaceButton}><AppText variant="meta">{workspaceState.isLoading ? 'Loading workspace…' : workspaceLabel}</AppText><SymbolView name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={12} tintColor={theme.colors.textSecondary} /></Pressable>
      </View>

      <View style={styles.viewArea}>
        {calendar.view === 'month' ? (
          <ContinuousMonthView
            ref={monthViewRef}
            selectedDate={calendar.selectedDate}
            visiblePeriod={calendar.visiblePeriod}
            workspaceId={workspaceState.selectedWorkspaceId}
            scrollState={monthScrollStates[workspaceState.selectedWorkspaceId]}
            onSelectDate={calendar.selectDate}
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
            scrollState={agendaScrollStates[workspaceState.selectedWorkspaceId]}
            onSelectDate={calendar.selectDate}
            onChangeVisiblePeriod={calendar.changeVisiblePeriod}
            onScrollStateChange={(state) => setAgendaScrollStates((current) => ({ ...current, [workspaceState.selectedWorkspaceId]: state }))}
            onOpenItem={(item) => { setCalendarItemActionMode(false); setSelectedCalendarItem(item); }}
            onLongPressItem={(item) => { setCalendarItemActionMode(true); setSelectedCalendarItem(item); }}
            onCreateForDate={(date) => { calendar.selectDate(date); calendar.setCreationSheetOpen(true); }}
          />
        ) : <PlaceholderView view={calendar.view} context={viewContext} />}
      </View>

      <View style={[styles.contextToolbar, { borderTopColor: theme.colors.borderSubtle, borderBottomColor: theme.colors.borderSubtle }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to today" onPress={() => { calendar.goToToday(); monthViewRef.current?.scrollToToday(); agendaViewRef.current?.scrollToDate(new Date()); }} style={styles.contextAction}><AppText variant="button" style={{ color: theme.colors.accent }}>Today</AppText></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose visible calendars" onPress={() => calendar.setSourceSheetOpen(true)} style={styles.contextAction}><SymbolView name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} size={17} tintColor={theme.colors.textSecondary} /><AppText variant="button">Calendars</AppText></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open calendar inbox" onPress={() => router.push('/notifications')} style={styles.contextAction}><SymbolView name={{ ios: 'tray', android: 'inbox', web: 'inbox' }} size={17} tintColor={theme.colors.textSecondary} /><AppText variant="button">Inbox</AppText></Pressable>
      </View>
    </View>

    <MonthCalendarItemSheet
      visible={Boolean(selectedCalendarItem)}
      item={selectedCalendarItem}
      actionMode={calendarItemActionMode}
      onClose={() => { setSelectedCalendarItem(null); setCalendarItemActionMode(false); }}
      onAction={(actionId, item) => { void handleCalendarItemAction(actionId, item); }}
    />

    <WorkspaceSelectorSheet visible={workspacePickerOpen} selectedWorkspaceId={workspaceState.selectedWorkspaceId} workspaces={workspaceState.options} onSelect={selectWorkspace} onClose={() => setWorkspacePickerOpen(false)} />
    <CalendarViewSheet visible={calendar.viewSheetOpen} value={calendar.view} onChange={changeCalendarView} onClose={() => calendar.setViewSheetOpen(false)} />
    <CalendarCreateSheet visible={calendar.creationSheetOpen} onClose={() => calendar.setCreationSheetOpen(false)} onSelect={openCreateFlow} />
    <CalendarSourcesSheet visible={calendar.sourceSheetOpen} workspaceLabel={workspaceLabel} onClose={() => calendar.setSourceSheetOpen(false)} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, paddingHorizontal: CALENDAR_PAGE_PADDING, paddingTop: 12, paddingBottom: 106 },
  toolbar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  parentButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 2 },
  iconTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  periodHeader: { paddingTop: 14, paddingBottom: 18, gap: 5 },
  workspaceButton: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  viewArea: { flex: 1 },
  placeholder: { flex: 1, minHeight: 260, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  placeholderText: { textAlign: 'center' },
  contextToolbar: { minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  contextAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
});
