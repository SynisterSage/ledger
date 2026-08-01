import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import {
  addCalendarMonths,
  formatCalendarDateKey,
  formatCalendarMonthKey,
  generateCalendarMonth,
  generateCalendarMonths,
  getCalendarWeekdayLabels,
  type CalendarMonth,
} from './calendarMonthGenerator';
import { useMobileCalendarItems } from './useMobileCalendarItems';
import type { MobileCalendarItem, MobileCalendarItemType } from './calendarItemNormalizer';
import type { CalendarFilters } from './calendarFilters';
import { SelectedDayAgenda } from './SelectedDayAgenda';

const INITIAL_MONTHS_BEFORE = 12;
const INITIAL_MONTHS_AFTER = 18;
const WEEK_HEIGHT = 88;
const MONTH_LABEL_HEIGHT = 52;
const EXTENSION_MONTHS = 12;
const TOP_EXTENSION_THRESHOLD = 420;
const MAX_VISIBLE_ITEMS = 2;

export type ContinuousMonthViewHandle = {
  scrollToToday: () => void;
  scrollToMonth: (date: Date) => void;
};

export type MonthScrollState = {
  offset: number;
  visibleMonthKey: string;
};

type ContinuousMonthViewProps = {
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

type CalendarSymbolName = ComponentProps<typeof SymbolView>['name'];

const symbolByItemType: Record<MobileCalendarItemType, CalendarSymbolName> = {
  event: { ios: 'calendar', android: 'event', web: 'event' },
  external_event: { ios: 'calendar', android: 'event', web: 'event' },
  reminder: { ios: 'bell', android: 'notifications_none', web: 'notifications_none' },
  task: { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' },
  project_action: { ios: 'arrow.turn.down.right', android: 'subdirectory_arrow_right', web: 'subdirectory_arrow_right' },
  milestone: { ios: 'diamond.fill', android: 'diamond', web: 'diamond' },
  project_deadline: { ios: 'target', android: 'gps_fixed', web: 'gps_fixed' },
};

const labelByItemType: Record<MobileCalendarItemType, string> = {
  event: 'Event',
  external_event: 'Imported event',
  reminder: 'Reminder',
  task: 'Task',
  project_action: 'Project action',
  milestone: 'Milestone',
  project_deadline: 'Project deadline',
};

function formatItemTime(item: MobileCalendarItem) {
  if (!item.startAt || item.allDay) return null;
  const date = new Date(item.startAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function MonthCalendarItem({ item, onPress, onLongPress }: { item: MobileCalendarItem; onPress: () => void; onLongPress: () => void }) {
  const theme = useLedgerTheme();
  const sourceColor = item.sourceColor ?? theme.colors.accent;
  const timeLabel = formatItemTime(item);
  const statusLabel = item.completed ? ', completed' : item.overdue ? ', overdue' : item.readOnly ? ', read only' : '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${labelByItemType[item.type]}, ${item.title}${timeLabel ? `, ${timeLabel}` : item.allDay ? ', all day' : ''}${item.projectName ? `, ${item.projectName}` : ''}${statusLabel}`}
      accessibilityHint="Opens calendar item details. Long press for actions."
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.itemRow, { opacity: pressed ? 0.62 : item.completed || item.overdue ? 0.58 : 1 }]}
    >
      <View style={[styles.itemSourceLine, { backgroundColor: sourceColor }]} />
      <SymbolView name={symbolByItemType[item.type]} size={10} tintColor={item.overdue ? theme.colors.warning : sourceColor} />
      {timeLabel ? <AppText variant="caption" style={styles.itemTime}>{timeLabel}</AppText> : null}
      <AppText variant="caption" numberOfLines={1} style={[styles.itemTitle, { color: theme.colors.textPrimary, textDecorationLine: item.completed ? 'line-through' : 'none' }]}>{item.title}</AppText>
    </Pressable>
  );
}

function MonthBlock({ month, selectedDate, itemsByDate, onSelectDate, onOpenItem, onLongPressItem, onCreateForDate }: { month: CalendarMonth; selectedDate: Date; itemsByDate: Record<string, MobileCalendarItem[]>; onSelectDate: (date: Date) => void; onOpenItem: (item: MobileCalendarItem) => void; onLongPressItem: (item: MobileCalendarItem) => void; onCreateForDate: (date: Date) => void }) {
  const theme = useLedgerTheme();
  const selectedKey = formatCalendarDateKey(selectedDate);
  const selectedMonthKey = formatCalendarMonthKey(selectedDate);

  return (
    <View>
      <View style={styles.monthLabel}>
        <AppText variant="bodyStrong" style={{ color: theme.colors.textPrimary }}>{month.label}</AppText>
      </View>
      {month.weeks.map((week, weekIndex) => <Fragment key={week[0].dateKey}>
        <View style={[styles.weekRow, { borderBottomColor: theme.colors.borderSubtle }]}>
          {week.map((day) => {
            const isSelected = month.monthKey === selectedMonthKey && day.dateKey === selectedKey;
            const dayItems = itemsByDate[day.dateKey] ?? [];
            const visibleItems = dayItems.slice(0, MAX_VISIBLE_ITEMS);
            const hiddenCount = Math.max(0, dayItems.length - visibleItems.length);
            return (
              <Pressable
                key={day.dateKey}
                accessibilityRole="button"
                accessibilityLabel={`${day.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${day.isToday ? ', today' : ''}${isSelected ? ', selected' : ''}${dayItems.length ? `, ${dayItems.length} calendar item${dayItems.length === 1 ? '' : 's'}` : ''}`}
                onPress={() => onSelectDate(day.date)}
                style={styles.dayCell}
              >
                <View style={[
                  styles.dayNumber,
                  day.isToday && { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
                  isSelected && !day.isToday && { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
                ]}>
                  <AppText variant="body" style={{
                    color: day.isToday ? '#FFFFFF' : day.isCurrentMonth ? theme.colors.textPrimary : theme.colors.textMuted,
                    fontWeight: isSelected || day.isToday ? '600' : '400',
                  }}>{day.dayNumber}</AppText>
                </View>
                <View style={styles.itemList}>
                  {visibleItems.map((item) => <MonthCalendarItem key={item.id} item={item} onPress={() => { onSelectDate(day.date); onOpenItem(item); }} onLongPress={() => { onSelectDate(day.date); onLongPressItem(item); }} />)}
                  {hiddenCount > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`${hiddenCount} more calendar item${hiddenCount === 1 ? '' : 's'} on ${day.date.toLocaleDateString([], { month: 'long', day: 'numeric' })}`} onPress={() => onSelectDate(day.date)} style={styles.overflowButton}><AppText variant="caption" numberOfLines={1} style={{ color: theme.colors.textMuted }}>+{hiddenCount}</AppText></Pressable> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {month.monthKey === selectedMonthKey && week.some((day) => day.dateKey === selectedKey) ? <SelectedDayAgenda date={selectedDate} items={itemsByDate[selectedKey] ?? []} onCreate={onCreateForDate} onOpenItem={onOpenItem} onLongPressItem={onLongPressItem} /> : null}
      </Fragment>)}
    </View>
  );
}

export const ContinuousMonthView = forwardRef<ContinuousMonthViewHandle, ContinuousMonthViewProps>(function ContinuousMonthView({ selectedDate, visiblePeriod, workspaceId, filters, scrollState, onSelectDate, onChangeVisiblePeriod, onScrollStateChange, onOpenItem = () => undefined, onLongPressItem = onOpenItem, onCreateForDate = () => undefined }, ref) {
  const theme = useLedgerTheme();
  const { width } = useWindowDimensions();
  const { itemsByDate, isLoading, error, retry } = useMobileCalendarItems(workspaceId, visiblePeriod, filters);
  const listRef = useRef<FlatList<Date>>(null);
  const today = useMemo(() => new Date(), []);
  const initialMonth = useMemo(() => addCalendarMonths(today, -INITIAL_MONTHS_BEFORE), [today]);
  const [months, setMonths] = useState(() => generateCalendarMonths(initialMonth, INITIAL_MONTHS_BEFORE + INITIAL_MONTHS_AFTER + 1));
  const [hasRestoredPosition, setHasRestoredPosition] = useState(false);
  const isExtendingTopRef = useRef(false);
  const previousWorkspaceIdRef = useRef(workspaceId);
  const previousSelectedDateKeyRef = useRef(formatCalendarDateKey(selectedDate));
  const firstWeekday = useMemo(() => {
    const labels = getCalendarWeekdayLabels();
    return labels;
  }, []);
  const monthItems = useMemo(() => months.map((date) => date), [months]);
  const monthByKey = useMemo(() => new Map(monthItems.map((date) => [formatCalendarMonthKey(date), date])), [monthItems]);
  const todayIndex = useMemo(() => monthItems.findIndex((date) => formatCalendarMonthKey(date) === formatCalendarMonthKey(today)), [monthItems, today]);

  const renderMonth = useCallback(({ item }: { item: Date }) => (
    <MonthBlock month={generateCalendarMonth(item, selectedDate, today)} selectedDate={selectedDate} itemsByDate={itemsByDate} onSelectDate={onSelectDate} onOpenItem={onOpenItem} onLongPressItem={onLongPressItem} onCreateForDate={onCreateForDate} />
  ), [itemsByDate, onCreateForDate, onLongPressItem, onOpenItem, onSelectDate, selectedDate, today]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset >= TOP_EXTENSION_THRESHOLD) isExtendingTopRef.current = false;
    if (offset < TOP_EXTENSION_THRESHOLD && months[0] && !isExtendingTopRef.current) {
      isExtendingTopRef.current = true;
      const first = months[0];
      setMonths((current) => [
        ...generateCalendarMonths(addCalendarMonths(first, -EXTENSION_MONTHS), EXTENSION_MONTHS),
        ...current,
      ]);
    }
  }, [months]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: Array<{ item?: Date; isViewable?: boolean }> }) => {
    const firstVisible = viewableItems.find((token) => token.isViewable !== false)?.item;
    if (!firstVisible) return;
    onChangeVisiblePeriod(firstVisible);
    onScrollStateChange?.({ offset: scrollState?.offset ?? 0, visibleMonthKey: formatCalendarMonthKey(firstVisible) });
  }, [onChangeVisiblePeriod, onScrollStateChange, scrollState?.offset]);

  const scrollToMonth = useCallback((date: Date) => {
    const index = months.findIndex((month) => formatCalendarMonthKey(month) === formatCalendarMonthKey(date));
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.18 });
      onChangeVisiblePeriod(date);
    }
  }, [months, onChangeVisiblePeriod]);

  useImperativeHandle(ref, () => ({
    scrollToToday: () => scrollToMonth(today),
    scrollToMonth,
  }), [scrollToMonth, today]);

  useEffect(() => {
    const selectedKey = formatCalendarDateKey(selectedDate);
    if (previousSelectedDateKeyRef.current === selectedKey || !hasRestoredPosition) return;
    previousSelectedDateKeyRef.current = selectedKey;
    requestAnimationFrame(() => scrollToMonth(selectedDate));
  }, [hasRestoredPosition, scrollToMonth, selectedDate]);

  useEffect(() => {
    if (previousWorkspaceIdRef.current !== workspaceId) {
      previousWorkspaceIdRef.current = workspaceId;
      setHasRestoredPosition(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (hasRestoredPosition || !scrollState) return;
    const target = monthByKey.get(scrollState.visibleMonthKey);
    if (!target) return;
    const index = months.findIndex((month) => formatCalendarMonthKey(month) === formatCalendarMonthKey(target));
    if (index >= 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.18 });
        setHasRestoredPosition(true);
      });
    }
  }, [hasRestoredPosition, monthByKey, months, scrollState]);

  useEffect(() => {
    if (scrollState || hasRestoredPosition) return;
    if (todayIndex < 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: todayIndex, animated: false, viewPosition: 0.3 });
      setHasRestoredPosition(true);
    });
  }, [hasRestoredPosition, scrollState, todayIndex]);

  useEffect(() => {
    if (formatCalendarMonthKey(visiblePeriod) === formatCalendarMonthKey(today)) return;
    const month = monthByKey.get(formatCalendarMonthKey(visiblePeriod));
    if (month && formatCalendarMonthKey(visiblePeriod) !== scrollState?.visibleMonthKey) {
      const index = months.findIndex((item) => formatCalendarMonthKey(item) === formatCalendarMonthKey(month));
      if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.18 });
    }
  }, [monthByKey, months, scrollState?.visibleMonthKey, today, visiblePeriod]);

  return (
    <View style={styles.container}>
      <View style={[styles.weekdayHeader, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.borderSubtle }]}>
        {firstWeekday.map((label, index) => <AppText key={`${label}-${index}`} variant="caption" style={styles.weekday}>{label}</AppText>)}
      </View>
      {error ? <View style={[styles.inlineError, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="caption" numberOfLines={1}>{error}</AppText><Pressable onPress={retry}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : isLoading ? <View style={[styles.loadingLine, { backgroundColor: theme.colors.surfaceMuted }]} /> : null}
      <FlatList
        ref={listRef}
        data={monthItems}
        renderItem={renderMonth}
        keyExtractor={(item) => formatCalendarMonthKey(item)}
        onScroll={onScroll}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 35 }}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          const last = months[months.length - 1];
          if (!last) return;
          setMonths((current) => [...current, ...generateCalendarMonths(addCalendarMonths(last, 1), EXTENSION_MONTHS)]);
        }}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.18 }), 80);
        }}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={7}
        removeClippedSubviews
        extraData={`${selectedDate.getTime()}-${workspaceId}-${width}`}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  weekdayHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  monthLabel: { height: MONTH_LABEL_HEIGHT, justifyContent: 'flex-end', paddingBottom: 9 },
  weekRow: { height: 96, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  dayCell: { flex: 1, minHeight: 44, alignItems: 'center', paddingTop: 7 },
  dayNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  itemList: { width: '100%', paddingHorizontal: 2, paddingTop: 2, gap: 1 },
  itemRow: { height: 17, width: '100%', flexDirection: 'row', alignItems: 'center', gap: 2, overflow: 'hidden' },
  itemSourceLine: { width: 2, height: 12, borderRadius: 1 },
  itemTime: { fontSize: 8, lineHeight: 10, maxWidth: 25 },
  itemTitle: { flex: 1, fontSize: 9, lineHeight: 11 },
  overflowButton: { height: 13, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 4 },
  inlineError: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  loadingLine: { height: 2, width: '35%', opacity: 0.45 },
});
