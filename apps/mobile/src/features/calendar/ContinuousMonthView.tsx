import { Fragment, forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef, useState, type ComponentProps } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { addCalendarMonths, formatCalendarDateKey, formatCalendarMonthKey, generateCalendarMonth, generateCalendarMonths, getCalendarWeekdayLabels, type CalendarMonth } from './calendarMonthGenerator';
import { useMobileMonthCalendarItems } from './useMobileMonthCalendarItems';
import type { MobileCalendarItem, MobileCalendarItemType } from './calendarItemNormalizer';
import type { CalendarFilters } from './calendarFilters';
import type { MonthDisplayMode } from './useMobileCalendarState';
import { CompactMonthView } from './CompactMonthView';
import { getCompactDayPresentation, type CompactDayPresentation } from './compactDayPresentation';
import { StackedMonthView } from './StackedMonthView';
import { getStackedDayPresentation, type StackedDayPresentation } from './stackedDayPresentation';

const MONTHS_BEFORE = 12;
const MONTHS_AFTER = 18;
const EXTENSION_MONTHS = 12;
const MAX_VISIBLE_ITEMS = 3;
const DETAILS_WEEK_HEIGHT = 112;
const DETAILS_MONTH_HEADER_HEIGHT = 48;
const COMPACT_WEEK_HEIGHT = 58;
const COMPACT_MONTH_HEADER_HEIGHT = 38;
const STACKED_WEEK_HEIGHT = 78;
const STACKED_MONTH_HEADER_HEIGHT = 38;

export type ContinuousMonthViewHandle = { scrollToToday: () => void; scrollToMonth: (date: Date, animated?: boolean) => void };
export type MonthScrollState = { offset: number; visibleMonthKey: string };

type Props = {
  mode?: MonthDisplayMode;
  selectedDate: Date;
  visiblePeriod: Date;
  workspaceId: string;
  workspaceReady?: boolean;
  filters?: CalendarFilters;
  scrollState?: MonthScrollState;
  onSelectDate: (date: Date) => void;
  onOpenDate?: (date: Date) => void;
  onChangeVisiblePeriod: (date: Date) => void;
  onScrollStateChange?: (state: MonthScrollState) => void;
  onOpenItem?: (item: MobileCalendarItem) => void;
  onLongPressItem?: (item: MobileCalendarItem) => void;
  onCreateForDate?: (date: Date) => void;
};

type SymbolName = ComponentProps<typeof SymbolView>['name'];
const iconByType: Record<MobileCalendarItemType, SymbolName> = {
  event: { ios: 'calendar', android: 'event', web: 'event' },
  external_event: { ios: 'calendar', android: 'event', web: 'event' },
  reminder: { ios: 'bell', android: 'notifications_none', web: 'notifications_none' },
  task: { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' },
  project_action: { ios: 'arrow.turn.down.right', android: 'subdirectory_arrow_right', web: 'subdirectory_arrow_right' },
  milestone: { ios: 'diamond.fill', android: 'diamond', web: 'diamond' },
  project_deadline: { ios: 'target', android: 'gps_fixed', web: 'gps_fixed' },
};

function itemTime(item: MobileCalendarItem) {
  if (!item.startAt || item.allDay) return null;
  const date = new Date(item.startAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    .replace(':00', '')
    .replace(/\s/g, '');
}

const MonthItem = memo(function MonthItem({ item, cellWidth, scheme, colors, onPress, onLongPress }: { item: MobileCalendarItem; cellWidth: number; scheme: 'light' | 'dark'; colors: ReturnType<typeof useLedgerTheme>['colors']; onPress: () => void; onLongPress: () => void }) {
  const color = item.sourceColor ?? colors.accent;
  const time = itemTime(item);
  const isWide = cellWidth >= 92;
  const isMedium = cellWidth >= 60;
  const showTime = Boolean(time && isWide && item.type !== 'project_deadline' && item.type !== 'milestone');
  const showTypeIcon = isMedium && item.type !== 'event' && item.type !== 'external_event';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}${time ? `, ${time}` : ''}`} onPress={onPress} onLongPress={onLongPress} hitSlop={{ top: 10, bottom: 10, left: 2, right: 2 }} style={({ pressed }) => [styles.item, {
    backgroundColor: scheme === 'dark' ? `${color}38` : `${color}24`,
    borderColor: item.overdue ? colors.warning : 'transparent',
    borderWidth: item.overdue ? StyleSheet.hairlineWidth : 0,
    opacity: pressed ? 0.55 : item.completed ? 0.62 : 1,
  }]}>
    <View style={[styles.itemBar, { backgroundColor: color, width: item.overdue ? 3 : 2 }]} />
    {showTypeIcon ? <SymbolView name={iconByType[item.type]} size={10} tintColor={color} /> : null}
    {showTime ? <Text numberOfLines={1} style={[styles.itemTime, { color: colors.textPrimary }]}>{time}</Text> : null}
    <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.itemTitle, { color: colors.textPrimary, textDecorationLine: item.completed ? 'line-through' : 'none' }]}>{item.title}</Text>
  </Pressable>;
});

const MonthBlock = memo(function MonthBlock({ month, selectedDate, itemsByDate, cellWidth, onSelectDate, onOpenItem, onLongPressItem }: { month: CalendarMonth; selectedDate: Date; itemsByDate: Record<string, MobileCalendarItem[]>; cellWidth: number; onSelectDate: (date: Date) => void; onOpenItem: (item: MobileCalendarItem) => void; onLongPressItem: (item: MobileCalendarItem) => void }) {
  const theme = useLedgerTheme();
  const selectedKey = formatCalendarDateKey(selectedDate);
  const dates = month.weeks.flat().filter((day) => day.isCurrentMonth);
  const weeks = Array.from({ length: Math.ceil(dates.length / 7) }, (_, index) => dates.slice(index * 7, index * 7 + 7));
  return <View>
    <View style={styles.monthLabel}><AppText variant="bodyStrong">{month.label}</AppText></View>
    {weeks.map((week) => <Fragment key={week[0]?.dateKey ?? month.monthKey}>
      <View style={[styles.week, { borderBottomColor: theme.colors.borderSubtle }]}>
        {week.map((day) => {
          const items = itemsByDate[day.dateKey] ?? [];
          const visibleCount = items.length > MAX_VISIBLE_ITEMS ? MAX_VISIBLE_ITEMS - 1 : MAX_VISIBLE_ITEMS;
          const visible = items.slice(0, visibleCount);
          const selected = day.dateKey === selectedKey;
          const today = day.isToday;
          const dayLabel = `Calendar date ${day.dateKey}${items.length ? `, ${items.length} items` : ''}`;
          return <View key={day.dateKey} style={styles.cell}>
            <Pressable accessibilityRole="button" accessibilityLabel={dayLabel} onPress={() => onSelectDate(day.date)} style={styles.cellTarget} />
            <Pressable accessibilityRole="button" accessibilityLabel={dayLabel} onPress={() => onSelectDate(day.date)} style={styles.dateTarget}>
              <View style={[styles.number, today && { backgroundColor: theme.colors.accent }, selected && !today && { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}><AppText variant="body" style={{ color: today ? '#FFFFFF' : day.isCurrentMonth ? theme.colors.textPrimary : theme.colors.textMuted, fontWeight: today || selected ? '700' : '400' }}>{day.dayNumber}</AppText></View>
            </Pressable>
            <View style={styles.items}>
              {visible.map((item) => <MonthItem key={item.id} item={item} cellWidth={cellWidth} scheme={theme.scheme} colors={theme.colors} onPress={() => onOpenItem(item)} onLongPress={() => onLongPressItem(item)} />)}
              {items.length > visible.length ? <Pressable accessibilityRole="button" onPress={() => onSelectDate(day.date)}><AppText variant="caption" style={styles.more}>+{items.length - visible.length} more</AppText></Pressable> : null}
            </View>
          </View>;
        })}
        {Array.from({ length: Math.max(0, 7 - week.length) }, (_, index) => <View key={`empty-${index}`} style={styles.cell} />)}
      </View>
    </Fragment>)}
  </View>;
});

export const ContinuousMonthView = forwardRef<ContinuousMonthViewHandle, Props>(function ContinuousMonthView({ mode = 'details', selectedDate, visiblePeriod, workspaceId, workspaceReady = true, filters, scrollState, onSelectDate, onOpenDate = () => undefined, onChangeVisiblePeriod, onScrollStateChange, onOpenItem = () => undefined, onLongPressItem = onOpenItem }, ref) {
  const theme = useLedgerTheme();
  const { width } = useWindowDimensions();
  const today = useMemo(() => new Date(), []);
  const [months, setMonths] = useState(() => generateCalendarMonths(addCalendarMonths(today, -MONTHS_BEFORE), MONTHS_BEFORE + MONTHS_AFTER + 1));
  const listRef = useRef<FlatList<Date>>(null);
  const monthIndex = useCallback((date: Date) => months.findIndex((month) => formatCalendarMonthKey(month) === formatCalendarMonthKey(date)), [months]);
  const firstGrid = useMemo(() => generateCalendarMonth(months[0], months[0]).weeks[0][0].dateKey, [months]);
  const lastMonth = months[months.length - 1];
  const lastGridMonth = useMemo(() => lastMonth ? generateCalendarMonth(lastMonth, lastMonth) : null, [lastMonth]);
  const lastWeek = lastGridMonth?.weeks[lastGridMonth.weeks.length - 1];
  const lastGrid = lastWeek?.[lastWeek.length - 1]?.dateKey ?? firstGrid;
  const { itemsByDate, isLoading, error, retry } = useMobileMonthCalendarItems(workspaceId, firstGrid, lastGrid, filters, workspaceReady);
  const compactPresentations = useMemo<Record<string, CompactDayPresentation>>(() => {
    if (mode !== 'compact') return {};
    return Object.fromEntries(Object.entries(itemsByDate).map(([dateKey, items]) => [dateKey, getCompactDayPresentation(items, theme.colors.accent)]));
  }, [itemsByDate, mode, theme.colors.accent]);
  const stackedPresentations = useMemo<Record<string, StackedDayPresentation>>(() => {
    if (mode !== 'stacked') return {};
    return Object.fromEntries(Object.entries(itemsByDate).map(([dateKey, items]) => [dateKey, getStackedDayPresentation(items, theme.colors.accent)]));
  }, [itemsByDate, mode, theme.colors.accent]);
  const initialIndex = Math.max(0, monthIndex(visiblePeriod));
  const monthHeight = useCallback((month: Date) => {
    const headerHeight = mode === 'compact' ? COMPACT_MONTH_HEADER_HEIGHT : mode === 'stacked' ? STACKED_MONTH_HEADER_HEIGHT : DETAILS_MONTH_HEADER_HEIGHT;
    const weekHeight = mode === 'compact' ? COMPACT_WEEK_HEIGHT : mode === 'stacked' ? STACKED_WEEK_HEIGHT : DETAILS_WEEK_HEIGHT;
    const monthGrid = generateCalendarMonth(month, selectedDate, today);
    const weekCount = mode === 'compact' || mode === 'stacked'
      ? monthGrid.weeks.length
      : Math.ceil(monthGrid.weeks.flat().filter((day) => day.isCurrentMonth).length / 7);
    return headerHeight + weekCount * weekHeight;
  }, [mode, selectedDate, today]);
  const monthOffset = useCallback((index: number) => {
    return months.slice(0, index).reduce((offset, month) => offset + monthHeight(month), 0);
  }, [monthHeight, months]);
  const scrollToMonth = useCallback((date: Date, animated = true) => {
    const index = monthIndex(date);
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, animated, viewPosition: 0.08 });
      onChangeVisiblePeriod(date);
    }
  }, [monthIndex, onChangeVisiblePeriod]);
  useImperativeHandle(ref, () => ({ scrollToToday: () => scrollToMonth(today), scrollToMonth }), [scrollToMonth, today]);
  const cellWidth = width / 7;
  const renderMonth = useCallback(({ item }: { item: Date }) => {
    const month = generateCalendarMonth(item, selectedDate, today);
    if (mode === 'compact') {
      return <CompactMonthView month={month} selectedDate={selectedDate} presentations={compactPresentations} onSelectDate={onSelectDate} onOpenDate={onOpenDate} />;
    }
    if (mode === 'stacked') {
      return <StackedMonthView month={month} selectedDate={selectedDate} presentations={stackedPresentations} onSelectDate={onSelectDate} onOpenDate={onOpenDate} />;
    }
    return <MonthBlock month={month} selectedDate={selectedDate} itemsByDate={itemsByDate} cellWidth={cellWidth} onSelectDate={onSelectDate} onOpenItem={onOpenItem} onLongPressItem={onLongPressItem} />;
  }, [cellWidth, compactPresentations, itemsByDate, mode, onLongPressItem, onOpenDate, onOpenItem, onSelectDate, selectedDate, stackedPresentations, today]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ item?: Date; isViewable?: boolean }> }) => {
    const first = viewableItems.find((entry) => entry.isViewable !== false)?.item;
    if (first) onChangeVisiblePeriod(first);
  }).current;
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    onScrollStateChange?.({ offset, visibleMonthKey: formatCalendarMonthKey(visiblePeriod) });
  }, [onScrollStateChange, visiblePeriod]);
  const getItemLayout = useCallback((_: ArrayLike<Date> | null | undefined, index: number) => {
    const month = months[index];
    return { length: month ? monthHeight(month) : DETAILS_MONTH_HEADER_HEIGHT, offset: monthOffset(index), index };
  }, [monthHeight, monthOffset, months]);

  return <View style={styles.container}>
    <View style={[styles.weekdays, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.borderSubtle }]}>{getCalendarWeekdayLabels().map((label, index) => <AppText key={`${label}-${index}`} variant="caption" style={styles.weekday}>{label}</AppText>)}</View>
    {error ? <View style={styles.status}><AppText variant="caption">{error}</AppText><Pressable onPress={retry}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : isLoading ? <View style={[styles.loading, { backgroundColor: theme.colors.surfaceMuted }]} /> : null}
    <FlatList ref={listRef} data={months} renderItem={renderMonth} keyExtractor={(item) => formatCalendarMonthKey(item)} extraData={{ itemsByDate, selectedDate, width, mode }} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={{ itemVisiblePercentThreshold: 35 }} onScroll={onScroll} scrollEventThrottle={100} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} initialScrollIndex={initialIndex} getItemLayout={getItemLayout} initialNumToRender={3} maxToRenderPerBatch={3} windowSize={5} onEndReached={() => { const last = months[months.length - 1]; if (last) setMonths((current) => [...current, ...generateCalendarMonths(addCalendarMonths(last, 1), EXTENSION_MONTHS)]); }} onScrollToIndexFailed={({ index }) => listRef.current?.scrollToOffset({ offset: monthOffset(index), animated: false })} />
  </View>;
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 0 },
  weekdays: { minHeight: 32, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  monthLabel: { height: DETAILS_MONTH_HEADER_HEIGHT, justifyContent: 'flex-end', paddingBottom: 8, paddingHorizontal: 2 },
  week: { height: DETAILS_WEEK_HEIGHT, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cell: { flex: 1, minWidth: 0, alignItems: 'stretch', paddingTop: 5, paddingHorizontal: 2 },
  cellTarget: { ...StyleSheet.absoluteFill, zIndex: 0 },
  dateTarget: { alignItems: 'flex-end', minHeight: 24, paddingRight: 1 },
  number: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  items: { gap: 2, paddingTop: 4 },
  item: { height: 24, minWidth: 0, borderRadius: 5, flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 8, paddingRight: 2, overflow: 'hidden' },
  itemBar: { position: 'absolute', top: 4, left: 4, height: 16, borderRadius: 2 },
  itemTime: { fontSize: 11, lineHeight: 14, fontWeight: '500', includeFontPadding: false, maxWidth: 28 },
  itemTitle: { flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 15, fontWeight: '500', includeFontPadding: false, letterSpacing: 0 },
  more: { fontSize: 10, lineHeight: 14, fontWeight: '500', paddingLeft: 5 },
  status: { minHeight: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  loading: { height: 2, width: '35%', opacity: 0.5 },
});
