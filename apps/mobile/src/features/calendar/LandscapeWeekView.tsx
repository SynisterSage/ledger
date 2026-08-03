import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMobileCalendarRange } from '@/api/calendar';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

import { filterCalendarItems, type CalendarFilters } from './calendarFilters';
import { formatCalendarDateKey, getCalendarFirstWeekday } from './calendarMonthGenerator';
import { normalizeCalendarRange, sortCalendarItems, type MobileCalendarItem } from './calendarItemNormalizer';
import { getTimedItemMinutes, positionDayItems, type PositionedDayItem } from './dayTimelineLayout';

const TIME_GUTTER_WIDTH = 58;
const TOOLBAR_HEIGHT = 42;
const DAY_HEADER_HEIGHT = 46;
const ALL_DAY_HEIGHT = 54;
const HOUR_HEIGHT = 58;
const DAY_COLUMN_MIN_WIDTH = 94;
const DAY_COUNT = 7;
const DAY_LABEL_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });
const WEEK_RANGE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

type Props = {
  selectedDate: Date;
  workspaceId: string;
  filters: CalendarFilters;
  scrollOffset?: number;
  onScrollOffsetChange: (offset: number) => void;
  onSelectDate: (date: Date) => void;
  onOpenItem: (item: MobileCalendarItem) => void;
  onLongPressItem: (item: MobileCalendarItem) => void;
  onCreateAtTime: (date: Date, minutes: number) => void;
  onBackToMonth: () => void;
  onChangeWeek: (amount: number) => void;
  onOpenViewSheet: () => void;
  onCreate: () => void;
};

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date) {
  return addDays(date, -((date.getDay() - getCalendarFirstWeekday() + 7) % 7));
}

function isSameDate(left: Date, right: Date) {
  return formatCalendarDateKey(left) === formatCalendarDateKey(right);
}

function itemColor(item: MobileCalendarItem, fallback: string) {
  return item.sourceColor || fallback;
}

function itemGlyph(item: MobileCalendarItem) {
  if (item.type === 'milestone') return '◆';
  if (item.type === 'task' || item.type === 'project_action') return '□';
  if (item.type === 'reminder') return '○';
  if (item.type === 'project_deadline') return '◎';
  return '';
}

function compactTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function getItemLabel(item: MobileCalendarItem) {
  return item.title || item.sourceName || 'Calendar item';
}

function getInitialOffset(items: MobileCalendarItem[], days: Date[]) {
  const today = new Date();
  if (days.some((day) => isSameDate(day, today))) {
    return Math.max(0, (today.getHours() - 1) * HOUR_HEIGHT + (today.getMinutes() / 60) * HOUR_HEIGHT);
  }
  const firstTimed = items
    .filter((item) => item.startAt && !item.allDay)
    .map((item) => getTimedItemMinutes(item).start)
    .sort((left, right) => left - right)[0];
  return Math.max(0, ((firstTimed ?? 8 * 60) / 60 - 1) * HOUR_HEIGHT);
}

export function LandscapeWeekView({
  selectedDate,
  workspaceId,
  filters,
  scrollOffset,
  onScrollOffsetChange,
  onSelectDate,
  onOpenItem,
  onLongPressItem,
  onCreateAtTime,
  onBackToMonth,
  onChangeWeek,
  onOpenViewSheet,
  onCreate,
}: Props) {
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const timelineRef = useRef<ScrollView>(null);
  const gutterRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(scrollOffset ?? 0);
  const didInitialScrollRef = useRef(false);
  const [items, setItems] = useState<MobileCalendarItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const days = useMemo(() => {
    const weekStart = startOfWeek(selectedDate);
    return Array.from({ length: DAY_COUNT }, (_, index) => addDays(weekStart, index));
  }, [selectedDate]);
  const weekStartKey = formatCalendarDateKey(days[0]);
  const weekEndKey = formatCalendarDateKey(days[DAY_COUNT - 1]);
  const dayColumnWidth = Math.max(DAY_COLUMN_MIN_WIDTH, Math.floor((width - TIME_GUTTER_WIDTH - 8) / 5));
  const canvasWidth = dayColumnWidth * DAY_COUNT;
  const timelineHeight = Math.max(240, height - insets.top - insets.bottom - TOOLBAR_HEIGHT - 4);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void getMobileCalendarRange(workspaceId, weekStartKey, weekEndKey)
      .then((payload) => {
        if (!cancelled) setItems(sortCalendarItems(filterCalendarItems(normalizeCalendarRange(payload), filters)));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [filters, weekEndKey, weekStartKey, workspaceId]);

  const itemsByDay = useMemo(() => days.map((day) => items.filter((item) => item.dateKey === formatCalendarDateKey(day))), [days, items]);
  const positionedByDay = useMemo(
    () => itemsByDay.map((dayItems) => positionDayItems(dayItems, HOUR_HEIGHT)),
    [itemsByDay],
  );
  const allDayByDay = useMemo(
    () => itemsByDay.map((dayItems) => dayItems.filter((item) => !item.startAt || item.allDay)),
    [itemsByDay],
  );

  useEffect(() => {
    if (isLoading || didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    const offset = scrollOffset ?? getInitialOffset(items, days);
    scrollOffsetRef.current = offset;
    requestAnimationFrame(() => {
      timelineRef.current?.scrollTo({ y: offset, animated: false });
      gutterRef.current?.scrollTo({ y: offset, animated: false });
    });
  }, [days, isLoading, items, scrollOffset]);

  useEffect(() => {
    didInitialScrollRef.current = false;
  }, [weekStartKey]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const syncTimeline = (offset: number) => {
    scrollOffsetRef.current = offset;
    gutterRef.current?.scrollTo({ y: offset, animated: false });
  };

  const commitScrollOffset = () => onScrollOffsetChange(scrollOffsetRef.current);

  const weekRange = `${WEEK_RANGE_FORMAT.format(days[0])} – ${WEEK_RANGE_FORMAT.format(days[6])}`;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.toolbar, { borderBottomColor: theme.colors.borderSubtle }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to month view" onPress={onBackToMonth} style={styles.toolbarButton}>
          <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={19} tintColor={theme.colors.textPrimary} />
          <AppText variant="bodyStrong">{days[0].toLocaleDateString([], { month: 'short' })}</AppText>
        </Pressable>
        <AppText variant="meta" style={styles.weekRange}>{weekRange}</AppText>
        <View style={styles.toolbarActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={() => onChangeWeek(-1)} style={styles.toolbarIcon}><SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={16} tintColor={theme.colors.textSecondary} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={() => onChangeWeek(1)} style={styles.toolbarIcon}><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.colors.textSecondary} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Switch calendar view" onPress={onOpenViewSheet} style={styles.toolbarIcon}><SymbolView name={{ ios: 'rectangle.3.group', android: 'view_module', web: 'view_module' }} size={19} tintColor={theme.colors.textPrimary} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Create calendar item" onPress={onCreate} style={styles.toolbarIcon}><SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={21} tintColor={theme.colors.textPrimary} /></Pressable>
        </View>
      </View>

      <View style={styles.gridRow}>
        <ScrollView ref={gutterRef} scrollEnabled={false} showsVerticalScrollIndicator={false} style={[styles.gutter, { width: TIME_GUTTER_WIDTH }]} contentContainerStyle={{ paddingTop: DAY_HEADER_HEIGHT + ALL_DAY_HEIGHT }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <View key={hour} style={[styles.hourRow, { height: HOUR_HEIGHT }]}>
              <AppText variant="caption" style={[styles.hourLabel, { color: theme.colors.textMuted }]}>{new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, hour))}</AppText>
            </View>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ width: canvasWidth }}>
          <View style={{ width: canvasWidth }}>
            <View style={[styles.dayHeader, { height: DAY_HEADER_HEIGHT, borderBottomColor: theme.colors.borderSubtle }]}>
              {days.map((day, index) => {
                const selected = isSameDate(day, selectedDate);
                const today = isSameDate(day, new Date());
                const dayItems = itemsByDay[index];
                return (
                  <Pressable key={formatCalendarDateKey(day)} onPress={() => onSelectDate(day)} style={[styles.dayHeaderCell, { width: dayColumnWidth }]}>
                    <AppText variant="caption" style={{ color: today || selected ? theme.colors.accent : theme.colors.textSecondary }}>{DAY_LABEL_FORMAT.format(day).split(' ')[0]}</AppText>
                    <View style={[styles.dayNumber, selected && { backgroundColor: theme.colors.accent }, today && !selected && { borderColor: theme.colors.accent, borderWidth: 1 }]}>
                      <AppText variant="bodyStrong" style={{ color: selected ? '#FFFFFF' : theme.colors.textPrimary }}>{day.getDate()}</AppText>
                    </View>
                    <View style={styles.activityDots}>{dayItems.slice(0, 3).map((item) => <View key={item.id} style={[styles.activityDot, { backgroundColor: itemColor(item, theme.colors.accent) }]} />)}</View>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.allDayLane, { height: ALL_DAY_HEIGHT, borderBottomColor: theme.colors.borderSubtle }]}>
              {allDayByDay.map((dayItems, index) => (
                <View key={formatCalendarDateKey(days[index])} style={[styles.allDayCell, { width: dayColumnWidth, borderRightColor: theme.colors.borderSubtle }]}>
                  {dayItems.slice(0, 2).map((item) => (
                    <Pressable key={item.id} onPress={() => onOpenItem(item)} onLongPress={() => onLongPressItem(item)} style={styles.allDayItem}>
                      <View style={[styles.itemAccent, { backgroundColor: itemColor(item, theme.colors.accent) }]} />
                      <AppText numberOfLines={1} variant="caption" style={styles.itemText}>{`${itemGlyph(item)} ${getItemLabel(item)}`.trim()}</AppText>
                    </Pressable>
                  ))}
                  {dayItems.length > 2 ? <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>+{dayItems.length - 2}</AppText> : null}
                </View>
              ))}
            </View>

            <ScrollView
              ref={timelineRef}
              style={{ height: timelineHeight }}
              showsVerticalScrollIndicator
              scrollEventThrottle={16}
              onScroll={(event) => syncTimeline(event.nativeEvent.contentOffset.y)}
              onScrollEndDrag={commitScrollOffset}
              onMomentumScrollEnd={commitScrollOffset}
            >
              <View style={{ height: 24 * HOUR_HEIGHT }}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <View key={hour} pointerEvents="none" style={[styles.gridHour, { top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT, borderBottomColor: theme.colors.borderSubtle }]}>
                    <View style={[styles.halfHourLine, { top: HOUR_HEIGHT / 2, backgroundColor: theme.colors.borderSubtle }]} />
                  </View>
                ))}
                {days.map((day, dayIndex) => (
                  <Pressable
                    key={`empty-day-${formatCalendarDateKey(day)}`}
                    accessibilityLabel={`Create item on ${day.toLocaleDateString([], { month: 'long', day: 'numeric' })}`}
                    onPress={(event) => {
                      const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round((event.nativeEvent.locationY / HOUR_HEIGHT) * 4) * 15));
                      onCreateAtTime(day, minutes);
                    }}
                    onLongPress={(event) => {
                      const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round((event.nativeEvent.locationY / HOUR_HEIGHT) * 4) * 15));
                      onCreateAtTime(day, minutes);
                    }}
                    style={[styles.emptySlot, { left: dayIndex * dayColumnWidth, top: 0, width: dayColumnWidth, height: 24 * HOUR_HEIGHT }]}
                  />
                ))}
                {days.map((day, dayIndex) => positionedByDay[dayIndex].map((positioned) => {
                  const item = positioned.item;
                  const sourceColor = itemColor(item, theme.colors.accent);
                  const widthRatio = 1 / positioned.columnCount;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => onOpenItem(item)}
                      onLongPress={() => onLongPressItem(item)}
                      onPressIn={() => undefined}
                      accessibilityRole="button"
                      accessibilityLabel={item.title}
                      style={[styles.eventBlock, { left: dayIndex * dayColumnWidth + positioned.column * dayColumnWidth * widthRatio + 3, top: positioned.top + 3, width: dayColumnWidth * widthRatio - 6, height: positioned.height - 6, backgroundColor: `${sourceColor}35`, borderLeftColor: sourceColor }]}
                    >
                      <AppText numberOfLines={1} variant="caption" style={styles.eventTitle}>{getItemLabel(item)}</AppText>
                      {positioned.height >= 62 && item.startAt ? <AppText numberOfLines={1} variant="caption" style={styles.eventTime}>{`${compactTime(new Date(item.startAt))}${item.endAt ? ` – ${compactTime(new Date(item.endAt))}` : ''}`}</AppText> : null}
                    </Pressable>
                  );
                }))}
                {days.map((day, index) => isSameDate(day, now) ? (
                  <View key={`now-${formatCalendarDateKey(day)}`} pointerEvents="none" style={[styles.nowLine, { left: index * dayColumnWidth + 2, top: (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT, width: dayColumnWidth - 4, backgroundColor: theme.colors.accent }]}>
                    <View style={[styles.nowBadge, { backgroundColor: theme.colors.accent }]}><AppText variant="caption" style={styles.nowText}>{compactTime(now)}</AppText></View>
                  </View>
                ) : null)}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: { height: TOOLBAR_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8 },
  toolbarButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 2 },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  toolbarIcon: { minWidth: 34, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  weekRange: { flex: 1, textAlign: 'center' },
  gridRow: { flex: 1, flexDirection: 'row' },
  gutter: { flexGrow: 0, backgroundColor: 'transparent' },
  hourRow: { alignItems: 'flex-end', justifyContent: 'flex-start', paddingRight: 5 },
  hourLabel: { fontSize: 10, lineHeight: 14, marginTop: -6 },
  dayHeader: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  dayHeaderCell: { alignItems: 'center', justifyContent: 'center', gap: 1 },
  dayNumber: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  activityDots: { height: 4, flexDirection: 'row', gap: 2 },
  activityDot: { width: 3, height: 3, borderRadius: 2 },
  allDayLane: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  allDayCell: { paddingHorizontal: 3, paddingVertical: 3, gap: 2, borderRightWidth: StyleSheet.hairlineWidth },
  allDayItem: { height: 20, flexDirection: 'row', alignItems: 'center', gap: 3, overflow: 'hidden' },
  itemAccent: { width: 2, height: 14, borderRadius: 1 },
  itemText: { flex: 1, fontSize: 10, lineHeight: 13 },
  gridHour: { position: 'absolute', left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  halfHourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, opacity: 0.45 },
  emptySlot: { position: 'absolute', zIndex: 0 },
  eventBlock: { position: 'absolute', borderLeftWidth: 3, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 3, overflow: 'hidden' },
  eventTitle: { color: '#FFFFFF', fontSize: 11, lineHeight: 14 },
  eventTime: { color: 'rgba(255,255,255,0.7)', fontSize: 9, lineHeight: 12 },
  nowLine: { position: 'absolute', height: 2, borderRadius: 1 },
  nowBadge: { position: 'absolute', left: -2, top: -8, minWidth: 38, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  nowText: { color: '#FFFFFF', fontSize: 9, lineHeight: 12 },
});
