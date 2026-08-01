import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { formatCalendarDateKey, getCalendarFirstWeekday } from './calendarMonthGenerator';
import { useMobileCalendarItems } from './useMobileCalendarItems';
import { DayAgendaItemRow } from './SelectedDayAgenda';
import { DayView, type DayViewHandle } from './DayView';
import type { MobileCalendarItem } from './calendarItemNormalizer';
import type { CalendarFilters } from './calendarFilters';

const WEEK_CELL_WIDTH = 48;

export type WeekViewHandle = {
  scrollToToday: () => void;
};

type WeekViewProps = {
  selectedDate: Date;
  workspaceId: string;
  filters?: CalendarFilters;
  scrollOffset?: number;
  onScrollOffsetChange?: (offset: number) => void;
  onSelectDate: (date: Date) => void;
  onOpenItem: (item: MobileCalendarItem) => void;
  onLongPressItem: (item: MobileCalendarItem) => void;
  onCreateAtTime: (date: Date, minutes: number) => void;
};

export type WeekDaySummary = {
  dateKey: string;
  totalItems: number;
  eventCount: number;
  reminderCount: number;
  taskCount: number;
  projectDateCount: number;
  hasOverdue: boolean;
  hasCurrentEvent: boolean;
};

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date) {
  const firstWeekday = getCalendarFirstWeekday();
  return addDays(date, -((date.getDay() - firstWeekday + 7) % 7));
}

function getWeekDates(date: Date) {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function getWeekPages(date: Date) {
  const currentStart = startOfWeek(date);
  return Array.from({ length: 9 }, (_, pageIndex) => getWeekDates(addDays(currentStart, (pageIndex - 4) * 7)));
}

function buildSummary(date: Date, items: MobileCalendarItem[]): WeekDaySummary {
  const dateKey = formatCalendarDateKey(date);
  const dayItems = items.filter((item) => item.dateKey === dateKey);
  return {
    dateKey,
    totalItems: dayItems.length,
    eventCount: dayItems.filter((item) => item.type === 'event' || item.type === 'external_event').length,
    reminderCount: dayItems.filter((item) => item.type === 'reminder').length,
    taskCount: dayItems.filter((item) => item.type === 'task' || item.type === 'project_action').length,
    projectDateCount: dayItems.filter((item) => item.type === 'milestone' || item.type === 'project_deadline').length,
    hasOverdue: dayItems.some((item) => item.overdue && !item.completed),
    hasCurrentEvent: dayItems.some((item) => (item.type === 'event' || item.type === 'external_event') && item.startAt && item.endAt && new Date(item.startAt).getTime() <= Date.now() && new Date(item.endAt).getTime() >= Date.now()),
  };
}

function WeekDateStrip({ selectedDate, summaries, onSelectDate }: { selectedDate: Date; summaries: WeekDaySummary[]; onSelectDate: (date: Date) => void }) {
  const theme = useLedgerTheme();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Date[]>>(null);
  const pages = useMemo(() => getWeekPages(selectedDate), [selectedDate]);
  const selectedWeekday = useMemo(() => {
    const dates = getWeekDates(selectedDate);
    return dates.findIndex((date) => formatCalendarDateKey(date) === formatCalendarDateKey(selectedDate));
  }, [selectedDate]);

  const scrollToSelectedWeek = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: 4, animated: false }));
  }, []);

  useEffect(() => { scrollToSelectedWeek(); }, [scrollToSelectedWeek, selectedDate]);

  return <FlatList
    ref={listRef}
    horizontal
    pagingEnabled
    data={pages}
    keyExtractor={(week) => formatCalendarDateKey(week[0])}
    showsHorizontalScrollIndicator={false}
    onMomentumScrollEnd={(event) => {
      const page = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
      const target = pages[page]?.[selectedWeekday >= 0 ? selectedWeekday : 0];
      if (target) onSelectDate(target);
    }}
    renderItem={({ item: week }) => <View style={[styles.weekPage, { width }]}>{week.map((date) => {
      const summary = summaries.find((entry) => entry.dateKey === formatCalendarDateKey(date));
      const selected = formatCalendarDateKey(date) === formatCalendarDateKey(selectedDate);
      const today = formatCalendarDateKey(date) === formatCalendarDateKey(new Date());
      return <Pressable key={formatCalendarDateKey(date)} accessibilityRole="button" accessibilityLabel={`${date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${today ? ', today' : ''}${selected ? ', selected' : ''}, ${summary?.totalItems ?? 0} items`} onPress={() => onSelectDate(date)} style={styles.weekCell}>
        <AppText variant="caption" style={{ color: selected ? theme.colors.accent : theme.colors.textMuted, fontWeight: '600' }}>{date.toLocaleDateString([], { weekday: 'short' }).slice(0, 3).toUpperCase()}</AppText>
        <View style={[styles.weekNumber, today && { borderColor: theme.colors.accent }, selected && { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }]}><AppText variant="body" style={{ color: selected ? '#FFFFFF' : theme.colors.textPrimary, fontWeight: selected || today ? '600' : '400' }}>{date.getDate()}</AppText></View>
        <View style={styles.density}><View style={[styles.dot, { backgroundColor: summary?.totalItems ? theme.colors.textMuted : 'transparent' }]} /><View style={[styles.dot, { backgroundColor: (summary?.totalItems ?? 0) > 2 ? theme.colors.textMuted : 'transparent' }]} /><View style={[styles.attentionDot, { backgroundColor: summary?.hasOverdue ? theme.colors.warning : 'transparent' }]} /></View>
      </Pressable>;
    })}</View>}
  />;
}

function WeekSummary({ summaries }: { summaries: WeekDaySummary[] }) {
  const theme = useLedgerTheme();
  const totals = summaries.reduce((result, summary) => ({ events: result.events + summary.eventCount, due: result.due + summary.reminderCount + summary.taskCount, deadlines: result.deadlines + summary.projectDateCount }), { events: 0, due: 0, deadlines: 0 });
  const values = [totals.events ? `${totals.events} events` : null, totals.due ? `${totals.due} due` : null, totals.deadlines ? `${totals.deadlines} deadlines` : null].filter(Boolean);
  return values.length ? <View style={styles.summary}><AppText variant="caption" style={{ color: theme.colors.textSecondary }}>{values.join('   ')}</AppText></View> : null;
}

export const WeekView = forwardRef<WeekViewHandle, WeekViewProps>(function WeekView({ selectedDate, workspaceId, filters, scrollOffset, onScrollOffsetChange, onSelectDate, onOpenItem, onLongPressItem, onCreateAtTime }, ref) {
  const theme = useLedgerTheme();
  const dayViewRef = useRef<DayViewHandle>(null);
  const { items } = useMobileCalendarItems(workspaceId, selectedDate, filters);
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const summaries = useMemo(() => weekDates.map((date) => buildSummary(date, items)), [items, weekDates]);
  const selectedDayItems = useMemo(() => items.filter((item) => item.dateKey === formatCalendarDateKey(selectedDate)), [items, selectedDate]);
  const laterItems = useMemo(() => items.filter((item) => item.dateKey > formatCalendarDateKey(selectedDate) && item.dateKey <= formatCalendarDateKey(weekDates[6]) && (item.type === 'milestone' || item.type === 'project_deadline' || item.overdue || (item.type === 'event' || item.type === 'external_event') && item.allDay)).slice(0, 5), [items, selectedDate, weekDates]);

  useImperativeHandle(ref, () => ({
    scrollToToday: () => {
      onSelectDate(new Date());
      requestAnimationFrame(() => dayViewRef.current?.scrollToUsefulPosition());
    },
  }), [onSelectDate]);

  const beforeContent = <View>
    <WeekDateStrip selectedDate={selectedDate} summaries={summaries} onSelectDate={onSelectDate} />
    <WeekSummary summaries={summaries} />
    <View style={[styles.selectedHeader, { borderTopColor: theme.colors.borderSubtle, borderBottomColor: theme.colors.borderSubtle }]}>
      <AppText variant="bodyStrong">{formatCalendarDateKey(selectedDate) === formatCalendarDateKey(new Date()) ? 'Today · ' : ''}{selectedDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</AppText>
      <AppText variant="caption">{selectedDayItems.length} item{selectedDayItems.length === 1 ? '' : 's'}</AppText>
    </View>
  </View>;

  const afterContent = laterItems.length ? <View style={styles.laterSection}><AppText variant="caption" style={styles.laterLabel}>Later this week</AppText>{laterItems.map((item) => <View key={item.id} style={styles.laterRow}><AppText variant="caption" style={styles.laterDate}>{new Date(`${item.dateKey}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric' }).toUpperCase()}</AppText><View style={styles.laterBody}><DayAgendaItemRow item={item} onPress={() => onOpenItem(item)} onLongPress={() => onLongPressItem(item)} /></View></View>)}</View> : null;

  return <DayView ref={dayViewRef} selectedDate={selectedDate} workspaceId={workspaceId} filters={filters} scrollOffset={scrollOffset} onScrollOffsetChange={onScrollOffsetChange} onSelectDate={onSelectDate} onOpenItem={onOpenItem} onLongPressItem={onLongPressItem} onCreateAtTime={onCreateAtTime} showDateStrip={false} beforeContent={beforeContent} afterContent={afterContent} />;
});

const styles = StyleSheet.create({
  weekPage: { flexDirection: 'row', justifyContent: 'center' },
  weekCell: { width: WEEK_CELL_WIDTH, minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: 3 },
  weekNumber: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  density: { height: 5, flexDirection: 'row', alignItems: 'center', gap: 2 },
  dot: { width: 3, height: 3, borderRadius: 2 },
  attentionDot: { width: 4, height: 4, borderRadius: 2 },
  summary: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  selectedHeader: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8 },
  laterSection: { paddingTop: 18 },
  laterLabel: { paddingHorizontal: 8, paddingBottom: 4, fontWeight: '700', textTransform: 'uppercase' },
  laterRow: { flexDirection: 'row', alignItems: 'flex-start' },
  laterDate: { width: 52, paddingTop: 14, paddingLeft: 8 },
  laterBody: { flex: 1 },
});
