import { Fragment, forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef, useState, type ComponentProps } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { addCalendarMonths, formatCalendarDateKey, formatCalendarMonthKey, generateCalendarMonth, generateCalendarMonths, getCalendarWeekdayLabels, type CalendarMonth } from './calendarMonthGenerator';
import { useMobileMonthCalendarItems } from './useMobileMonthCalendarItems';
import type { MobileCalendarItem, MobileCalendarItemType } from './calendarItemNormalizer';
import type { CalendarFilters } from './calendarFilters';
import { SelectedDayAgenda } from './SelectedDayAgenda';

const MONTHS_BEFORE = 12;
const MONTHS_AFTER = 18;
const EXTENSION_MONTHS = 12;
const MAX_VISIBLE_ITEMS = 3;

export type ContinuousMonthViewHandle = { scrollToToday: () => void; scrollToMonth: (date: Date) => void };
export type MonthScrollState = { offset: number; visibleMonthKey: string };

type Props = {
  selectedDate: Date;
  visiblePeriod: Date;
  workspaceId: string;
  filters?: CalendarFilters;
  scrollState?: MonthScrollState;
  onSelectDate: (date: Date) => void;
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
  const value = new Date(item.startAt);
  return Number.isNaN(value.getTime()) ? null : value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const MonthItem = memo(function MonthItem({ item, onPress, onLongPress }: { item: MobileCalendarItem; onPress: () => void; onLongPress: () => void }) {
  const theme = useLedgerTheme();
  const color = item.sourceColor ?? theme.colors.accent;
  const time = itemTime(item);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}${time ? `, ${time}` : ''}`} onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.item, { backgroundColor: `${color}22`, opacity: pressed ? 0.55 : item.completed ? 0.5 : 1 }]}>
    <View style={[styles.itemBar, { backgroundColor: color }]} />
    <SymbolView name={iconByType[item.type]} size={9} tintColor={color} />
    {time ? <AppText variant="caption" numberOfLines={1} style={styles.itemTime}>{time}</AppText> : null}
    <AppText variant="caption" numberOfLines={1} style={[styles.itemTitle, { color: theme.colors.textPrimary, textDecorationLine: item.completed ? 'line-through' : 'none' }]}>{item.title}</AppText>
  </Pressable>;
});

const MonthBlock = memo(function MonthBlock({ month, selectedDate, itemsByDate, onSelectDate, onOpenItem, onLongPressItem, onCreateForDate }: { month: CalendarMonth; selectedDate: Date; itemsByDate: Record<string, MobileCalendarItem[]>; onSelectDate: (date: Date) => void; onOpenItem: (item: MobileCalendarItem) => void; onLongPressItem: (item: MobileCalendarItem) => void; onCreateForDate: (date: Date) => void }) {
  const theme = useLedgerTheme();
  const selectedKey = formatCalendarDateKey(selectedDate);
  return <View>
    <View style={styles.monthLabel}><AppText variant="bodyStrong">{month.label}</AppText></View>
    {month.weeks.map((week) => <Fragment key={week[0].dateKey}>
      <View style={[styles.week, { borderBottomColor: theme.colors.borderSubtle }]}>
        {week.map((day) => {
          const items = itemsByDate[day.dateKey] ?? [];
          const visible = items.slice(0, MAX_VISIBLE_ITEMS);
          const more = items.length - visible.length;
          const selected = day.dateKey === selectedKey;
          return <View key={day.dateKey} style={styles.cell}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${day.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${items.length ? `, ${items.length} items` : ''}`} onPress={() => onSelectDate(day.date)} style={styles.dateTarget}>
              <View style={[styles.number, day.isToday && { backgroundColor: theme.colors.accent }, selected && !day.isToday && { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}><AppText variant="body" style={{ color: day.isToday ? '#FFFFFF' : day.isCurrentMonth ? theme.colors.textPrimary : theme.colors.textMuted, fontWeight: day.isToday || selected ? '700' : '400' }}>{day.dayNumber}</AppText></View>
            </Pressable>
            <View style={styles.items}>
              {visible.map((item) => <MonthItem key={item.id} item={item} onPress={() => { onSelectDate(day.date); onOpenItem(item); }} onLongPress={() => { onSelectDate(day.date); onLongPressItem(item); }} />)}
              {more > 0 ? <Pressable accessibilityRole="button" onPress={() => onSelectDate(day.date)}><AppText variant="caption" style={styles.more}>+{more} more</AppText></Pressable> : null}
            </View>
          </View>;
        })}
      </View>
      {month.monthKey === formatCalendarMonthKey(selectedDate) && week.some((day) => day.dateKey === selectedKey) ? <SelectedDayAgenda date={selectedDate} items={itemsByDate[selectedKey] ?? []} onCreate={onCreateForDate} onOpenItem={onOpenItem} onLongPressItem={onLongPressItem} /> : null}
    </Fragment>)}
  </View>;
});

export const ContinuousMonthView = forwardRef<ContinuousMonthViewHandle, Props>(function ContinuousMonthView({ selectedDate, visiblePeriod, workspaceId, filters, scrollState, onSelectDate, onChangeVisiblePeriod, onScrollStateChange, onOpenItem = () => undefined, onLongPressItem = onOpenItem, onCreateForDate = () => undefined }, ref) {
  const theme = useLedgerTheme();
  const { width } = useWindowDimensions();
  const { itemsByDate, isLoading, error, retry } = useMobileMonthCalendarItems(workspaceId, visiblePeriod, filters);
  const listRef = useRef<FlatList<Date>>(null);
  const today = useMemo(() => new Date(), []);
  const [months, setMonths] = useState(() => generateCalendarMonths(addCalendarMonths(today, -MONTHS_BEFORE), MONTHS_BEFORE + MONTHS_AFTER + 1));
  const monthItems = useMemo(() => months, [months]);
  const viewableConfig = useRef({ itemVisiblePercentThreshold: 35 }).current;
  const monthIndex = useCallback((date: Date) => months.findIndex((item) => formatCalendarMonthKey(item) === formatCalendarMonthKey(date)), [months]);
  const scrollToMonth = useCallback((date: Date) => { const index = monthIndex(date); if (index >= 0) { listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.12 }); onChangeVisiblePeriod(date); } }, [monthIndex, onChangeVisiblePeriod]);
  useImperativeHandle(ref, () => ({ scrollToToday: () => scrollToMonth(today), scrollToMonth }), [scrollToMonth, today]);

  const renderMonth = useCallback(({ item }: { item: Date }) => <MonthBlock month={generateCalendarMonth(item, selectedDate, today)} selectedDate={selectedDate} itemsByDate={itemsByDate} onSelectDate={onSelectDate} onOpenItem={onOpenItem} onLongPressItem={onLongPressItem} onCreateForDate={onCreateForDate} />, [itemsByDate, onCreateForDate, onLongPressItem, onOpenItem, onSelectDate, selectedDate, today]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ item?: Date; isViewable?: boolean }> }) => { const first = viewableItems.find((entry) => entry.isViewable !== false)?.item; if (first) onChangeVisiblePeriod(first); }).current;
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => { const offset = event.nativeEvent.contentOffset.y; const first = months[0]; if (offset < 350 && first) setMonths((current) => [...generateCalendarMonths(addCalendarMonths(first, -EXTENSION_MONTHS), EXTENSION_MONTHS), ...current]); onScrollStateChange?.({ offset, visibleMonthKey: formatCalendarMonthKey(visiblePeriod) }); }, [months, onScrollStateChange, visiblePeriod]);

  return <View style={styles.container}>
    <View style={[styles.weekdays, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.borderSubtle }]}>{getCalendarWeekdayLabels().map((label, index) => <AppText key={`${label}-${index}`} variant="caption" style={styles.weekday}>{label}</AppText>)}</View>
    {error ? <View style={styles.status}><AppText variant="caption">{error}</AppText><Pressable onPress={retry}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : isLoading ? <View style={[styles.loading, { backgroundColor: theme.colors.surfaceMuted }]} /> : null}
    <FlatList ref={listRef} data={monthItems} renderItem={renderMonth} keyExtractor={(item) => formatCalendarMonthKey(item)} extraData={{ itemsByDate, selectedDate, width }} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewableConfig} onScroll={onScroll} scrollEventThrottle={100} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} initialNumToRender={3} maxToRenderPerBatch={3} windowSize={5} onEndReached={() => { const last = months[months.length - 1]; if (last) setMonths((current) => [...current, ...generateCalendarMonths(addCalendarMonths(last, 1), EXTENSION_MONTHS)]); }} onScrollToIndexFailed={({ index }) => setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.12 }), 100)} />
  </View>;
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 24 },
  weekdays: { minHeight: 32, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  monthLabel: { height: 48, justifyContent: 'flex-end', paddingBottom: 8, paddingHorizontal: 2 },
  week: { minHeight: 104, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { flex: 1, minWidth: 0, alignItems: 'stretch', paddingTop: 6, paddingHorizontal: 2 },
  dateTarget: { alignItems: 'center', minHeight: 28 },
  number: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  items: { gap: 2, paddingTop: 2 },
  item: { height: 19, minWidth: 0, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 2, overflow: 'hidden' },
  itemBar: { width: 2, height: 13, borderRadius: 1 },
  itemTime: { fontSize: 8, maxWidth: 25 },
  itemTitle: { flex: 1, minWidth: 0, fontSize: 9, lineHeight: 11 },
  more: { fontSize: 9, paddingLeft: 3 },
  status: { minHeight: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  loading: { height: 2, width: '35%', opacity: 0.5 },
});
