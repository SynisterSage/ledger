import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileCalendarItem, MobileCalendarItemType } from './calendarItemNormalizer';

type AgendaGroup = {
  id: string;
  label: string;
  items: MobileCalendarItem[];
};

type SelectedDayAgendaProps = {
  date: Date;
  items: MobileCalendarItem[];
  onCreate: (date: Date) => void;
  onOpenItem: (item: MobileCalendarItem) => void;
  onLongPressItem: (item: MobileCalendarItem) => void;
};

const iconByType: Record<MobileCalendarItemType, { ios: string; android: string; web: string }> = {
  event: { ios: 'calendar', android: 'event', web: 'event' },
  external_event: { ios: 'calendar', android: 'event', web: 'event' },
  reminder: { ios: 'bell', android: 'notifications_none', web: 'notifications_none' },
  task: { ios: 'checkmark.circle', android: 'check_circle_outline', web: 'check_circle_outline' },
  project_action: { ios: 'checklist', android: 'checklist', web: 'checklist' },
  milestone: { ios: 'diamond.fill', android: 'diamond', web: 'diamond' },
  project_deadline: { ios: 'target', android: 'gps_fixed', web: 'gps_fixed' },
};

function getTime(item: MobileCalendarItem) {
  if (!item.startAt || item.allDay) return null;
  const date = new Date(item.startAt);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getEndOrDuration(item: MobileCalendarItem) {
  if (!item.endAt || !item.startAt || item.allDay) return null;
  const start = new Date(item.startAt).getTime();
  const end = new Date(item.endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const minutes = Math.round((end - start) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function isCurrent(item: MobileCalendarItem) {
  if (!item.startAt || !item.endAt || item.allDay) return false;
  const now = Date.now();
  const start = new Date(item.startAt).getTime();
  const end = new Date(item.endAt).getTime();
  return start <= now && end >= now;
}

function isPast(item: MobileCalendarItem) {
  if (item.completed) return true;
  if (item.endAt && !item.allDay) return new Date(item.endAt).getTime() < Date.now();
  return Boolean(item.overdue);
}

function buildAgendaGroups(items: MobileCalendarItem[]): AgendaGroup[] {
  const completedOrPast = items.filter((item) => item.completed || isPast(item));
  const active = items.filter((item) => !item.completed && !isPast(item));
  const groups: AgendaGroup[] = [
    { id: 'in-progress', label: 'In progress', items: active.filter((item) => item.type === 'task' || item.type === 'project_action').filter((item) => !item.overdue) },
    { id: 'timed', label: 'Schedule', items: active.filter((item) => (item.type === 'event' || item.type === 'external_event') && !item.allDay) },
    { id: 'all-day', label: 'All day', items: active.filter((item) => (item.type === 'event' || item.type === 'external_event') && item.allDay) },
    { id: 'reminders', label: 'Reminders', items: active.filter((item) => item.type === 'reminder') },
    { id: 'work', label: 'Tasks and actions', items: active.filter((item) => item.type === 'task' || item.type === 'project_action' || item.overdue) },
    { id: 'project-dates', label: 'Project dates', items: active.filter((item) => item.type === 'milestone' || item.type === 'project_deadline') },
    { id: 'completed', label: 'Completed or past', items: completedOrPast },
  ];
  return groups.filter((group) => group.items.length > 0);
}

export function DayAgendaItemRow({ item, onPress, onLongPress }: { item: MobileCalendarItem; onPress: () => void; onLongPress: () => void }) {
  const theme = useLedgerTheme();
  const current = isCurrent(item);
  const past = isPast(item);
  const time = getTime(item);
  const duration = getEndOrDuration(item);
  const detail = item.projectName ?? item.sourceName ?? (item.overdue ? 'Overdue' : item.allDay ? 'All day' : null);
  const stateLabel = item.completed ? ', completed' : item.overdue ? ', overdue' : current ? ', now' : item.readOnly ? ', read only' : '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.type.replace('_', ' ')}, ${item.title}${time ? `, ${time}` : item.allDay ? ', all day' : ''}${detail ? `, ${detail}` : ''}${stateLabel}`}
      accessibilityHint="Opens item details. Long press for actions."
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.62 : past ? 0.52 : 1 }]}
    >
      <View style={styles.timeColumn}>
        {current ? <AppText variant="caption" style={{ color: theme.colors.accent, fontWeight: '700' }}>NOW</AppText> : <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>{time ?? 'ALL DAY'}</AppText>}
      </View>
      <View style={[styles.accentLine, { backgroundColor: item.sourceColor ?? theme.colors.accent }]} />
      <SymbolView name={iconByType[item.type] as never} size={15} tintColor={item.overdue ? theme.colors.warning : item.sourceColor ?? theme.colors.textMuted} />
      <View style={styles.rowBody}>
        <AppText variant="body" numberOfLines={1} style={{ color: theme.colors.textPrimary, fontWeight: current ? '600' : '400', textDecorationLine: item.completed ? 'line-through' : 'none' }}>{item.title}</AppText>
        <AppText variant="meta" numberOfLines={1}>{[duration ? `Ends ${item.endAt ? new Date(item.endAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}` : null, detail].filter(Boolean).join(' · ')}</AppText>
      </View>
    </Pressable>
  );
}

export function SelectedDayAgenda({ date, items, onCreate, onOpenItem, onLongPressItem }: SelectedDayAgendaProps) {
  const theme = useLedgerTheme();
  const groups = useMemo(() => buildAgendaGroups(items), [items]);
  const dateLabel = date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <View style={[styles.container, { borderTopColor: theme.colors.borderStrong, borderBottomColor: theme.colors.borderSubtle, backgroundColor: theme.colors.surfaceCard }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="bodyStrong" accessibilityLabel={`${dateLabel}, selected, ${items.length} items`}>{dateLabel}</AppText>
          <AppText variant="caption">{items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'No items scheduled'}</AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Create item for ${dateLabel}`} onPress={() => onCreate(date)} style={styles.createButton}>
          <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={18} tintColor={theme.colors.accent} />
        </Pressable>
      </View>

      {!items.length ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Create something for ${dateLabel}`} onPress={() => onCreate(date)} style={styles.emptyState}>
          <AppText variant="meta">No items scheduled</AppText>
          <AppText variant="button" style={{ color: theme.colors.accent }}>+ Create something</AppText>
        </Pressable>
      ) : groups.map((group) => (
        <View key={group.id} style={styles.group}>
          <AppText variant="caption" style={styles.groupLabel}>{group.label}</AppText>
          {group.items.map((item) => <DayAgendaItemRow key={item.id} item={item} onPress={() => onOpenItem(item)} onLongPress={() => onLongPressItem(item)} />)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: 1, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, marginTop: 3, marginBottom: 8 },
  header: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  headerText: { gap: 2 },
  createButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emptyState: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  group: { marginTop: 7 },
  groupLabel: { paddingHorizontal: 8, paddingBottom: 2, fontWeight: '600' },
  row: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  timeColumn: { width: 54, alignItems: 'flex-end' },
  accentLine: { width: 2, height: 28, borderRadius: 1 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
});
