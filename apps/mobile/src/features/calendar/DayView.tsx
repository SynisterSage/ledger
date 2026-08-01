import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { formatCalendarDateKey, getCalendarFirstWeekday } from './calendarMonthGenerator';
import { useMobileCalendarItems } from './useMobileCalendarItems';
import { DayAgendaItemRow } from './SelectedDayAgenda';
import { getDayMinutes, positionDayItems, type PositionedDayItem } from './dayTimelineLayout';
import type { MobileCalendarItem } from './calendarItemNormalizer';
import type { CalendarFilters } from './calendarFilters';

const CELL_WIDTH = 48;
const HOUR_HEIGHT = 64;
const TIMELINE_START_HOUR = 0;
const TIMELINE_END_HOUR = 24;

type DayViewProps = {
  selectedDate: Date;
  workspaceId: string;
  filters?: CalendarFilters;
  scrollOffset?: number;
  onScrollOffsetChange?: (offset: number) => void;
  onSelectDate: (date: Date) => void;
  onOpenItem: (item: MobileCalendarItem) => void;
  onLongPressItem: (item: MobileCalendarItem) => void;
  onCreateAtTime: (date: Date, minutes: number) => void;
  showDateStrip?: boolean;
  beforeContent?: ReactNode;
  afterContent?: ReactNode;
};

export type DayViewHandle = {
  scrollToUsefulPosition: () => void;
};

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getWeekDates(date: Date) {
  const start = addDays(date, -((date.getDay() - getCalendarFirstWeekday() + 7) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function formatTime(minutes: number) {
  const date = new Date(2024, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function isToday(date: Date) {
  return formatCalendarDateKey(date) === formatCalendarDateKey(new Date());
}

function DayDateStrip({ date, onSelectDate }: { date: Date; onSelectDate: (date: Date) => void }) {
  const theme = useLedgerTheme();
  const { width } = useWindowDimensions();
  const dates = useMemo(() => Array.from({ length: 29 }, (_, index) => addDays(date, index - 14)), [date]);
  const listRef = useRef<FlatList<Date>>(null);
  const initialIndex = 14;

  useEffect(() => {
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: initialIndex, animated: false, viewPosition: 0.5 }));
  }, [date]);

  const selectFromOffset = useCallback((offsetX: number) => {
    const index = Math.max(0, Math.min(dates.length - 1, Math.round((offsetX + width / 2 - CELL_WIDTH / 2) / CELL_WIDTH)));
    const next = dates[index];
    if (next) onSelectDate(next);
  }, [dates, onSelectDate, width]);

  return <FlatList
    ref={listRef}
    horizontal
    data={dates}
    keyExtractor={(item) => formatCalendarDateKey(item)}
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={{ paddingHorizontal: Math.max(0, (width - CELL_WIDTH * 7) / 2) }}
    onMomentumScrollEnd={(event) => selectFromOffset(event.nativeEvent.contentOffset.x)}
    getItemLayout={(_, index) => ({ length: CELL_WIDTH, offset: CELL_WIDTH * index, index })}
    renderItem={({ item }) => {
      const selected = formatCalendarDateKey(item) === formatCalendarDateKey(date);
      const today = isToday(item);
      return <Pressable accessibilityRole="button" accessibilityLabel={`${item.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${today ? ', today' : ''}${selected ? ', selected' : ''}`} onPress={() => onSelectDate(item)} style={styles.dateCell}>
        <AppText variant="caption" style={{ color: selected ? theme.colors.accent : theme.colors.textMuted }}>{item.toLocaleDateString([], { weekday: 'narrow' })}</AppText>
        <View style={[styles.dateNumber, today && { borderColor: theme.colors.accent }, selected && { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }]}><AppText variant="body" style={{ color: selected ? '#FFFFFF' : theme.colors.textPrimary, fontWeight: selected || today ? '600' : '400' }}>{item.getDate()}</AppText></View>
      </Pressable>;
    }}
  />;
}

function DayEventBlock({ positioned, onPress, onLongPress }: { positioned: PositionedDayItem; onPress: () => void; onLongPress: () => void }) {
  const theme = useLedgerTheme();
  const { item, column, columnCount, top, height } = positioned;
  const color = item.sourceColor ?? theme.colors.accent;
  const marker = item.type === 'reminder' ? '○ ' : item.type === 'task' ? '□ ' : item.type === 'project_action' ? '↳ ' : '';
  const start = item.startAt ? new Date(item.startAt) : null;
  const end = item.endAt ? new Date(item.endAt) : null;
  const timeLabel = start && end ? `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : start?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.type.replace('_', ' ')}, ${item.title}, ${timeLabel ?? 'timed'}${item.projectName ? `, ${item.projectName}` : ''}${item.completed ? ', completed' : item.overdue ? ', overdue' : ''}`} onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.eventBlock, { top, height, left: `${(column * 100) / columnCount}%`, width: `${100 / columnCount}%`, opacity: pressed ? 0.65 : item.completed || item.overdue ? 0.55 : 1, backgroundColor: `${color}14`, borderLeftColor: color }]}>
    <AppText variant="caption" numberOfLines={height > 52 ? 2 : 1} style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{marker}{item.title}</AppText>
    {height > 48 ? <AppText variant="caption" numberOfLines={1}>{[timeLabel, item.projectName ?? item.sourceName].filter(Boolean).join(' · ')}</AppText> : null}
  </Pressable>;
}

export const DayView = forwardRef<DayViewHandle, DayViewProps>(function DayView({ selectedDate, workspaceId, filters, scrollOffset, onScrollOffsetChange, onSelectDate, onOpenItem, onLongPressItem, onCreateAtTime, showDateStrip = true, beforeContent, afterContent }, ref) {
  const theme = useLedgerTheme();
  const { itemsByDate, isLoading, error, retry } = useMobileCalendarItems(workspaceId, selectedDate, filters);
  const scrollRef = useRef<ScrollView>(null);
  const restoredKeyRef = useRef<string | null>(null);
  const [timelineTop, setTimelineTop] = useState(0);
  const [, setClock] = useState(() => Date.now());
  const dayKey = formatCalendarDateKey(selectedDate);
  const dayItems = useMemo(() => itemsByDate[dayKey] ?? [], [dayKey, itemsByDate]);
  const allDayItems = useMemo(() => dayItems.filter((item) => (item.type === 'event' || item.type === 'external_event') && item.allDay), [dayItems]);
  const dueItems = useMemo(() => dayItems.filter((item) => !(item.type === 'event' || item.type === 'external_event') || !item.allDay).filter((item) => item.allDay || !item.startAt), [dayItems]);
  const timedItems = useMemo(() => dayItems.filter((item) => Boolean(item.startAt) && !item.allDay), [dayItems]);
  const positionedItems = useMemo(() => positionDayItems(timedItems, HOUR_HEIGHT), [timedItems]);
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);

  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!timelineTop) return;
    const restoreKey = `${workspaceId}:${dayKey}`;
    if (restoredKeyRef.current === restoreKey) return;
    restoredKeyRef.current = restoreKey;
    if (typeof scrollOffset === 'number') {
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: scrollOffset, animated: false }));
      return;
    }
    const firstFuture = positionedItems.find((item) => item.top + item.height > (isToday(selectedDate) ? new Date().getHours() * HOUR_HEIGHT : 8 * HOUR_HEIGHT));
    const hour = firstFuture ? Math.max(0, Math.floor(firstFuture.top / HOUR_HEIGHT) - 1) : isToday(selectedDate) ? Math.max(0, new Date().getHours() - 1) : 8;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, timelineTop + hour * HOUR_HEIGHT), animated: false }));
  }, [dayKey, scrollOffset, timelineTop, workspaceId]);

  useImperativeHandle(ref, () => ({
    scrollToUsefulPosition: () => {
      const firstFuture = positionedItems.find((item) => item.top + item.height > (isToday(selectedDate) ? new Date().getHours() * HOUR_HEIGHT : 8 * HOUR_HEIGHT));
      const hour = firstFuture ? Math.max(0, Math.floor(firstFuture.top / HOUR_HEIGHT) - 1) : isToday(selectedDate) ? Math.max(0, new Date().getHours() - 1) : 8;
      scrollRef.current?.scrollTo({ y: Math.max(0, timelineTop + hour * HOUR_HEIGHT), animated: false });
    },
  }), [positionedItems, selectedDate, timelineTop]);

  const renderHour = (hour: number) => <View key={hour} style={[styles.hourRow, { borderTopColor: theme.colors.borderSubtle }]}><View style={styles.timeGutter}><AppText variant="caption">{formatTime(hour * 60)}</AppText></View><Pressable accessibilityRole="button" accessibilityLabel={`Create item at ${formatTime(hour * 60)} on ${selectedDate.toLocaleDateString([], { month: 'long', day: 'numeric' })}`} onPress={(event) => { const quarter = Math.max(0, Math.min(3, Math.round((event.nativeEvent.locationY / HOUR_HEIGHT) * 4))); onCreateAtTime(selectedDate, hour * 60 + quarter * 15); }} style={styles.hourContent} /></View>;

  const currentIndicator = isToday(selectedDate) ? getDayMinutes(new Date().toISOString()) : null;

  return <View style={styles.container}>
    {showDateStrip ? <DayDateStrip date={selectedDate} onSelectDate={onSelectDate} /> : null}
    {error ? <View style={[styles.errorRow, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="caption" numberOfLines={1}>{error}</AppText><Pressable onPress={retry}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : null}
    <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} onScroll={(event) => onScrollOffsetChange?.(event.nativeEvent.contentOffset.y)} scrollEventThrottle={100} contentContainerStyle={styles.scrollContent}>
      {beforeContent}
      {allDayItems.length ? <View style={styles.section}><AppText variant="caption" style={styles.sectionLabel}>All day{allDayItems.length > 1 ? ` ${allDayItems.length}` : ''}</AppText>{allDayItems.slice(0, 3).map((item) => <DayAgendaItemRow key={item.id} item={item} onPress={() => onOpenItem(item)} onLongPress={() => onLongPressItem(item)} />)}{allDayItems.length > 3 ? <AppText variant="caption" style={styles.moreLabel}>+{allDayItems.length - 3} more</AppText> : null}</View> : null}
      {dueItems.length ? <View style={styles.section}><AppText variant="caption" style={styles.sectionLabel}>Due today {dueItems.length}</AppText>{dueItems.map((item) => <DayAgendaItemRow key={item.id} item={item} onPress={() => onOpenItem(item)} onLongPress={() => onLongPressItem(item)} />)}</View> : null}
      <View onLayout={(event) => setTimelineTop(event.nativeEvent.layout.y)} style={styles.timelineSection}>
        <View style={styles.timelineHeader}><AppText variant="caption" style={styles.sectionLabel}>Schedule</AppText>{isLoading ? <AppText variant="caption">Loading…</AppText> : null}</View>
        <View style={styles.timeline}>
          {Array.from({ length: TIMELINE_END_HOUR - TIMELINE_START_HOUR }, (_, index) => renderHour(index + TIMELINE_START_HOUR))}
          {currentIndicator !== null ? <View pointerEvents="none" style={[styles.currentLine, { top: (currentIndicator / 60) * HOUR_HEIGHT, borderTopColor: theme.colors.accent }]}><AppText variant="caption" style={{ color: theme.colors.accent }}>NOW</AppText></View> : null}
          {positionedItems.map((positioned) => <DayEventBlock key={positioned.item.id} positioned={positioned} onPress={() => onOpenItem(positioned.item)} onLongPress={() => onLongPressItem(positioned.item)} />)}
        </View>
      </View>
      {afterContent}
    </ScrollView>
  </View>;
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  dateCell: { width: CELL_WIDTH, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 4 },
  dateNumber: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  section: { paddingTop: 10, paddingBottom: 6 },
  sectionLabel: { paddingHorizontal: 8, paddingBottom: 4, fontWeight: '700', textTransform: 'uppercase' },
  moreLabel: { paddingHorizontal: 8, paddingTop: 4 },
  timelineSection: { paddingTop: 12 },
  timelineHeader: { minHeight: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timeline: { position: 'relative', height: (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * HOUR_HEIGHT },
  hourRow: { height: HOUR_HEIGHT, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  timeGutter: { width: 58, alignItems: 'flex-end', paddingRight: 8, paddingTop: 5 },
  hourContent: { flex: 1 },
  eventBlock: { position: 'absolute', minHeight: 34, marginLeft: 62, marginRight: 6, padding: 7, borderLeftWidth: 3, borderRadius: 5, overflow: 'hidden' },
  currentLine: { position: 'absolute', left: 58, right: 0, borderTopWidth: 1, zIndex: 10 },
  errorRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
