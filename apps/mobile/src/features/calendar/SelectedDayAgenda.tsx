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

function getAgendaMetadata(item: MobileCalendarItem) {
  const parts = [item.location, item.projectName];
  if (!item.location && !item.projectName && item.sourceName && !['Reminders', 'Tasks'].includes(item.sourceName)) {
    parts.push(item.sourceName);
  }
  return parts.filter(Boolean).join(' · ');
}

function getAgendaTrailing(item: MobileCalendarItem) {
  if (!item.startAt || item.allDay) return item.type === 'task' || item.type === 'project_action' || item.type === 'milestone' || item.type === 'project_deadline' ? 'Due' : 'All day';
  const start = new Date(item.startAt);
  const end = item.endAt ? new Date(item.endAt) : null;
  return {
    start: start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    end: end && !Number.isNaN(end.getTime()) ? end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null,
  };
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

export function getAgendaRowHeight(item: MobileCalendarItem) {
  return getAgendaMetadata(item) ? 72 : 58;
}

export function DayAgendaItemRow({ item, compact = false, agenda = false, onPress, onLongPress }: { item: MobileCalendarItem; compact?: boolean; agenda?: boolean; onPress: () => void; onLongPress: () => void }) {
  const theme = useLedgerTheme();
  const current = isCurrent(item);
  const past = isPast(item);
  const time = getTime(item);
  const duration = getEndOrDuration(item);
  const detail = item.projectName ?? item.sourceName ?? (item.overdue ? 'Overdue' : item.allDay ? 'All day' : null);
  const agendaMetadata = getAgendaMetadata(item);
  const agendaTrailing = getAgendaTrailing(item);
  const stateLabel = item.completed ? ', completed' : item.overdue ? ', overdue' : current ? ', now' : item.readOnly ? ', read only' : '';

  if (agenda) {
    const showGlyph = item.type !== 'event' && item.type !== 'external_event';
    const trailingLabel = typeof agendaTrailing === 'string' ? agendaTrailing : agendaTrailing.start;
    return <Pressable accessibilityRole="button" accessibilityLabel={`${item.type.replace('_', ' ')}, ${item.title}, ${trailingLabel}${typeof agendaTrailing !== 'string' && agendaTrailing.end ? `, ends ${agendaTrailing.end}` : ''}${agendaMetadata ? `, ${agendaMetadata}` : ''}${stateLabel}`} accessibilityHint="Opens item details. Long press for actions." onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.agendaRow, { minHeight: getAgendaRowHeight(item), opacity: pressed ? 0.62 : past ? 0.66 : 1 }]}>
      <View style={[styles.agendaAccent, { backgroundColor: item.sourceColor ?? theme.colors.accent }]} />
      {showGlyph ? <SymbolView name={iconByType[item.type] as never} size={11} tintColor={item.overdue ? theme.colors.warning : item.sourceColor ?? theme.colors.textMuted} /> : null}
      <View style={styles.agendaBody}>
        <AppText variant="body" numberOfLines={1} style={[styles.agendaTitle, { color: theme.colors.textPrimary, fontWeight: current ? '600' : '500', textDecorationLine: item.completed ? 'line-through' : 'none' }]}>{item.title}</AppText>
        {agendaMetadata ? <AppText variant="caption" numberOfLines={1} style={styles.agendaDetail}>{agendaMetadata}</AppText> : null}
      </View>
      <View style={styles.agendaTimes}>
        <AppText variant="caption" numberOfLines={1} style={[styles.agendaStart, { color: current ? theme.colors.accent : theme.colors.textPrimary }]}>{trailingLabel}</AppText>
        {typeof agendaTrailing !== 'string' && agendaTrailing.end ? <AppText variant="caption" numberOfLines={1} style={styles.agendaEnd}>{agendaTrailing.end}</AppText> : null}
      </View>
    </Pressable>;
  }

  if (compact) {
    return <Pressable accessibilityRole="button" accessibilityLabel={`${item.type.replace('_', ' ')}, ${item.title}${detail ? `, ${detail}` : ''}${stateLabel}`} accessibilityHint="Opens item details. Long press for actions." onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.compactRow, { opacity: pressed ? 0.62 : past ? 0.52 : 1 }]}>
      <SymbolView name={iconByType[item.type] as never} size={12} tintColor={item.overdue ? theme.colors.warning : item.sourceColor ?? theme.colors.textMuted} />
      <AppText variant="meta" numberOfLines={1} style={[styles.compactTitle, { color: theme.colors.textPrimary, fontWeight: current ? '600' : '500', textDecorationLine: item.completed ? 'line-through' : 'none' }]}>{item.title}</AppText>
      {detail ? <AppText variant="caption" numberOfLines={1} style={styles.compactDetail}>{detail}</AppText> : null}
    </Pressable>;
  }

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
  agendaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 8, paddingVertical: 7 },
  agendaAccent: { width: 3, height: 32, borderRadius: 2 },
  agendaBody: { flex: 1, minWidth: 0, gap: 2 },
  agendaTitle: { minWidth: 0, fontSize: 15, lineHeight: 19 },
  agendaDetail: { minWidth: 0, color: '#A5A5AA' },
  agendaTimes: { width: 70, alignItems: 'flex-end', justifyContent: 'center', gap: 1 },
  agendaStart: { width: '100%', textAlign: 'right', fontSize: 14, lineHeight: 18 },
  agendaEnd: { width: '100%', textAlign: 'right', color: '#929299', fontSize: 14, lineHeight: 18 },
  compactRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 8 },
  compactTitle: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
  compactDetail: { maxWidth: 130 },
  timeColumn: { width: 54, alignItems: 'flex-end' },
  accentLine: { width: 2, height: 28, borderRadius: 1 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
});
