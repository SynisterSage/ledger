import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useLedgerTheme } from '@/theme';
import { getMobileCalendarRange } from '@/api/calendar';
import { normalizeCalendarRange, type MobileCalendarItem } from './calendarItemNormalizer';
import { formatCalendarDateKey, generateCalendarMonth, getCalendarFirstWeekday } from './calendarMonthGenerator';
import { filterCalendarItems, type CalendarFilters } from './calendarFilters';

type Props = { visibleYear: number; selectedDate: Date; workspaceId: string; filters: CalendarFilters; onSelectMonth: (date: Date) => void; onSelectDate: (date: Date) => void; onVisibleYearChange: (year: number) => void };
const YEAR_BLOCK_HEIGHT = 707;

function yearRange(year: number) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function useYearItems(workspaceId: string, year: number, filters: CalendarFilters) {
  const [items, setItems] = useState<MobileCalendarItem[]>([]);
  useEffect(() => {
    let active = true;
    const range = yearRange(year);
    void getMobileCalendarRange(workspaceId, range.start, range.end).then((payload) => {
      if (!active) return;
      setItems(normalizeCalendarRange(payload));
    }).catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, [workspaceId, year]);
  return useMemo(() => {
    const filtered = filterCalendarItems(items, filters);
    return filtered.reduce<Record<string, MobileCalendarItem[]>>((groups, item) => {
      (groups[item.dateKey] ??= []).push(item);
      return groups;
    }, {});
  }, [filters, items]);
}

type YearColors = ReturnType<typeof useLedgerTheme>['colors'];

const MiniMonth = memo(function MiniMonth({ date, selectedDate, itemsByDate, colors, todayKey, today, onSelectMonth, onSelectDate }: { date: Date; selectedDate: Date; itemsByDate: Record<string, MobileCalendarItem[]>; colors: YearColors; todayKey: string; today: Date; onSelectMonth: (date: Date) => void; onSelectDate: (date: Date) => void }) {
  const month = generateCalendarMonth(date, selectedDate, today, getCalendarFirstWeekday());
  const selectedMonth = month.monthKey === `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`;
  const activityCount = month.weeks.flat().reduce((count, day) => count + (itemsByDate[day.dateKey]?.length ?? 0), 0);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${month.label}${selectedMonth ? ', selected month' : ''}${activityCount ? `, ${activityCount} calendar items` : ''}`} onPress={() => onSelectMonth(month.date)} style={styles.miniMonth}>
    <View style={styles.miniHeader}><Text style={[styles.miniMonthLabel, { color: selectedMonth || month.monthKey === todayKey.slice(0, 7) ? colors.accent : colors.textPrimary }]}>{month.label.slice(0, 3)}</Text></View>
    <View style={styles.miniGrid}>{month.weeks.flatMap((week) => week.map((day) => {
      const count = itemsByDate[day.dateKey]?.length ?? 0;
      const isToday = day.dateKey === todayKey;
      const isSelected = day.dateKey === formatCalendarDateKey(selectedDate);
      return <Pressable key={day.dateKey} accessibilityRole="button" accessibilityLabel={`Calendar date ${day.dateKey}${isToday ? ', today' : ''}${count ? `, ${count} items` : ''}`} onPress={() => { onSelectDate(day.date); onSelectMonth(day.date); }} style={styles.miniDay}><View style={[styles.miniDayNumber, isToday && { backgroundColor: colors.accent }, isSelected && !isToday && { borderColor: colors.accent, borderWidth: 1 }]}><Text style={[styles.miniDayLabel, { color: isToday ? '#fff' : day.isCurrentMonth ? colors.textPrimary : colors.textMuted }]}>{day.dayNumber}</Text></View>{count ? <View style={[styles.dayDot, { backgroundColor: colors.accent }]} /> : null}</Pressable>;
    }))}</View>
  </Pressable>;
});

const YearBlock = memo(function YearBlock({ year, selectedDate, itemsByDate, colors, todayKey, today, onSelectMonth, onSelectDate }: { year: number; selectedDate: Date; itemsByDate: Record<string, MobileCalendarItem[]>; colors: YearColors; todayKey: string; today: Date; onSelectMonth: (date: Date) => void; onSelectDate: (date: Date) => void }) {
  return <View style={styles.yearBlock}><Text style={[styles.yearTitle, { color: colors.textPrimary }]}>{year}</Text><View style={styles.monthGrid}>{Array.from({ length: 12 }, (_, index) => <MiniMonth key={`${year}-${index}`} date={new Date(year, index, 1)} selectedDate={selectedDate} itemsByDate={itemsByDate} colors={colors} todayKey={todayKey} today={today} onSelectMonth={onSelectMonth} onSelectDate={onSelectDate} />)}</View><View style={[styles.yearRule, { borderBottomColor: colors.borderSubtle }]} /></View>;
});

export function YearOverview({ visibleYear, selectedDate, workspaceId, filters, onSelectMonth, onSelectDate, onVisibleYearChange }: Props) {
  const theme = useLedgerTheme();
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => formatCalendarDateKey(today), [today]);
  const [anchorYear] = useState(visibleYear);
  const years = useMemo(() => Array.from({ length: 5 }, (_, index) => anchorYear - 2 + index), [anchorYear]);
  const itemsByDate = useYearItems(workspaceId, visibleYear, filters);
  const listRef = useRef<FlatList<number>>(null);
  const lastReportedYearRef = useRef<number | null>(null);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(years.length - 1, Math.round(event.nativeEvent.contentOffset.y / YEAR_BLOCK_HEIGHT)));
    const year = years[index];
    if (year !== undefined && year !== lastReportedYearRef.current) {
      lastReportedYearRef.current = year;
      onVisibleYearChange(year);
    }
  }, [onVisibleYearChange, years]);
  const getItemLayout = useCallback((_: ArrayLike<number> | null | undefined, index: number) => ({ length: YEAR_BLOCK_HEIGHT, offset: YEAR_BLOCK_HEIGHT * index, index }), []);
  return <FlatList ref={listRef} data={years} keyExtractor={(year) => String(year)} renderItem={({ item }) => <YearBlock year={item} selectedDate={selectedDate} itemsByDate={itemsByDate} colors={theme.colors} todayKey={todayKey} today={today} onSelectMonth={onSelectMonth} onSelectDate={onSelectDate} />} contentContainerStyle={styles.content} onScroll={onScroll} scrollEventThrottle={100} showsVerticalScrollIndicator={false} removeClippedSubviews initialScrollIndex={2} getItemLayout={getItemLayout} initialNumToRender={1} maxToRenderPerBatch={1} windowSize={2} />;
}

const styles = StyleSheet.create({ content: { paddingBottom: 32 }, yearBlock: { height: YEAR_BLOCK_HEIGHT, paddingBottom: 18 }, yearTitle: { fontSize: 30, lineHeight: 38, fontWeight: '700', includeFontPadding: false, marginBottom: 12 }, monthGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 18, columnGap: 8 }, miniMonth: { width: '31.8%', minHeight: 142 }, miniHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 }, miniMonthLabel: { fontSize: 16, lineHeight: 24, fontWeight: '600', includeFontPadding: false }, miniGrid: { flexDirection: 'row', flexWrap: 'wrap' }, miniDay: { width: `${100 / 7}%`, height: 19, alignItems: 'center', justifyContent: 'center' }, miniDayNumber: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, miniDayLabel: { fontSize: 10, lineHeight: 16, includeFontPadding: false }, dayDot: { position: 'absolute', bottom: 0, width: 3, height: 3, borderRadius: 2 }, yearRule: { borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 16 } });
