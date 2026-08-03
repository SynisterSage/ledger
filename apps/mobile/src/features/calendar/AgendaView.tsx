import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { formatCalendarDateKey } from './calendarMonthGenerator';
import { buildAgendaListEntries, dateLabel, type AgendaListEntry } from './agendaListBuilder';
import { useMobileAgendaItems } from './useMobileAgendaItems';
import { DayAgendaItemRow, getAgendaRowHeight } from './SelectedDayAgenda';
import type { MobileCalendarItem } from './calendarItemNormalizer';
import type { CalendarFilters } from './calendarFilters';

export type AgendaViewHandle = {
  scrollToDate: (date: Date) => void;
};

export type AgendaScrollState = {
  offset: number;
  anchorDateKey: string;
};

type AgendaViewProps = {
  selectedDate: Date;
  workspaceId: string;
  filters?: CalendarFilters;
  scrollState?: AgendaScrollState;
  onSelectDate: (date: Date) => void;
  onChangeVisiblePeriod: (date: Date) => void;
  onScrollStateChange?: (state: AgendaScrollState) => void;
  onOpenItem: (item: MobileCalendarItem) => void;
  onLongPressItem: (item: MobileCalendarItem) => void;
  onCreateForDate: (date: Date) => void;
};

function dateFromKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`);
}

const isToday = (dateKey: string) => dateKey === formatCalendarDateKey(new Date());

export const AgendaView = forwardRef<AgendaViewHandle, AgendaViewProps>(function AgendaView({ selectedDate, workspaceId, filters, scrollState, onSelectDate, onChangeVisiblePeriod, onScrollStateChange, onOpenItem, onLongPressItem, onCreateForDate }, ref) {
  const theme = useLedgerTheme();
  const listRef = useRef<FlatList<AgendaListEntry>>(null);
  const [hasRestored, setHasRestored] = useState(false);
  const [, setClock] = useState(() => Date.now());
  const extendingPastRef = useRef(false);
  const { items, isLoading, error, extendPast, extendFuture, retry } = useMobileAgendaItems(workspaceId, selectedDate, filters);
  const { entries } = useMemo(() => buildAgendaListEntries(items, selectedDate), [items, selectedDate]);
  const stickyHeaderIndices = useMemo(() => entries.flatMap((entry, index) => entry.type === 'date_header' ? [index] : []), [entries]);
  const dateIndex = useMemo(() => new Map(entries.flatMap((entry, index) => entry.type === 'date_header' ? [[entry.dateKey, index] as const] : [])), [entries]);
  const getItemLayout = useCallback((_: ArrayLike<AgendaListEntry> | null | undefined, index: number) => {
    const offset = entries.slice(0, index).reduce((total, entry) => total + (entry.type === 'date_header' ? 38 : entry.type === 'item' ? getAgendaRowHeight(entry.item) : 0), 0);
    const entry = entries[index];
    return { length: entry?.type === 'date_header' ? 38 : entry?.type === 'item' ? getAgendaRowHeight(entry.item) : 0, offset, index };
  }, [entries]);

  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const scrollToDate = useCallback((date: Date) => {
    const index = dateIndex.get(formatCalendarDateKey(date));
    if (index === undefined) return;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.08 });
    onChangeVisiblePeriod(date);
  }, [dateIndex, onChangeVisiblePeriod]);

  useImperativeHandle(ref, () => ({ scrollToDate }), [scrollToDate]);

  useEffect(() => {
    if (hasRestored) return;
    const target = scrollState?.anchorDateKey ? dateIndex.get(scrollState.anchorDateKey) : dateIndex.get(formatCalendarDateKey(selectedDate));
    if (target === undefined) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: target, animated: false, viewPosition: 0.08 });
      setHasRestored(true);
    });
  }, [dateIndex, hasRestored, scrollState?.anchorDateKey, selectedDate]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset < 420 && !extendingPastRef.current) {
      extendingPastRef.current = true;
      extendPast();
    }
    if (offset > 700) extendingPastRef.current = false;
  }, [extendPast]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: Array<{ item?: AgendaListEntry; isViewable?: boolean }> }) => {
    const dateHeader = viewableItems.find((token) => token.isViewable !== false && token.item?.type === 'date_header')?.item;
    if (!dateHeader || dateHeader.type !== 'date_header') return;
    const date = dateFromKey(dateHeader.dateKey);
    onChangeVisiblePeriod(date);
    onScrollStateChange?.({ offset: scrollState?.offset ?? 0, anchorDateKey: dateHeader.dateKey });
  }, [onChangeVisiblePeriod, onScrollStateChange, scrollState?.offset]);

  const renderEntry = useCallback(({ item }: { item: AgendaListEntry }) => {
    if (item.type === 'date_header') {
      return <View style={[styles.dateHeader, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="meta" style={{ color: isToday(item.dateKey) ? theme.colors.accent : theme.colors.textPrimary, fontWeight: '600' }}>{dateLabel(item.dateKey)}</AppText></View>;
    }
    if (item.type === 'group_header') return null;
    const itemDate = dateFromKey(item.item.dateKey);
    return <DayAgendaItemRow item={item.item} agenda onPress={() => { onSelectDate(itemDate); onOpenItem(item.item); }} onLongPress={() => { onSelectDate(itemDate); onLongPressItem(item.item); }} />;
  }, [items, onLongPressItem, onOpenItem, onSelectDate, theme.colors]);

  return <View style={styles.container}>
    {error ? <View style={[styles.errorRow, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="caption" numberOfLines={1}>{error}</AppText><Pressable onPress={retry}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : null}
    <FlatList
      ref={listRef}
      data={entries}
      renderItem={renderEntry}
      keyExtractor={(entry) => entry.type === 'date_header' ? `date:${entry.dateKey}` : entry.type === 'group_header' ? `group:${entry.id}` : `item:${entry.item.id}`}
      stickyHeaderIndices={stickyHeaderIndices}
      onScroll={onScroll}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={{ itemVisiblePercentThreshold: 35 }}
      scrollEventThrottle={100}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      getItemLayout={getItemLayout}
      onEndReachedThreshold={0.35}
      onEndReached={extendFuture}
      ListFooterComponent={isLoading ? <AppText variant="caption" style={styles.loading}>Loading more dates…</AppText> : null}
      extraData={`${selectedDate.getTime()}-${workspaceId}`}
    />
  </View>;
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 16 },
  dateHeader: { minHeight: 38, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  errorRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  loading: { padding: 14, textAlign: 'center' },
});
