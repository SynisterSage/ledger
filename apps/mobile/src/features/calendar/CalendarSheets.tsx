import { Pressable, StyleSheet, View, TextInput } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import type { MobileCalendarView } from './useMobileCalendarState';
import { useLedgerTheme } from '@/theme';
import { getMobileCalendarRange, createMobileCalendar } from '@/api/calendar';
import { normalizeCalendarRange, type MobileCalendarItem } from './calendarItemNormalizer';
import { defaultCalendarFilters, type CalendarFilters } from './calendarFilters';

type CalendarSymbolName = ComponentProps<typeof SymbolView>['name'];

const viewOptions: Array<{ id: MobileCalendarView; label: string }> = [
  { id: 'month', label: 'Month' }, { id: 'agenda', label: 'Agenda' }, { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' },
];

export function CalendarViewSheet({ visible, value, onChange, onClose }: { visible: boolean; value: MobileCalendarView; onChange: (view: MobileCalendarView) => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  return (
    <AppBottomSheet visible={visible} onClose={onClose} title="View calendar" snapPoints={['42%', '58%']} initialSnapPointIndex={0}>
      <View>
        {viewOptions.map((option) => {
          const selected = option.id === value;
          return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${option.label} calendar view`} onPress={() => { onChange(option.id); onClose(); }} style={({ pressed }) => [styles.option, { borderBottomColor: theme.colors.borderSubtle, opacity: pressed ? 0.68 : 1 }]}>
            <AppText variant="bodyStrong">{option.label}</AppText>
            {selected ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={18} tintColor={theme.colors.accent} /> : null}
          </Pressable>;
        })}
      </View>
    </AppBottomSheet>
  );
}

type CreateHref = '/capture/event' | '/capture/reminder' | '/capture/task' | '/capture/project-action';

export function CalendarCreateSheet({ visible, onSelect, onClose }: { visible: boolean; onSelect: (href: CreateHref) => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  const options: Array<{ label: string; href: CreateHref; icon: CalendarSymbolName }> = [
    { label: 'Event', href: '/capture/event', icon: { ios: 'calendar', android: 'event', web: 'event' } }, { label: 'Reminder', href: '/capture/reminder', icon: { ios: 'bell', android: 'notifications_none', web: 'notifications_none' } }, { label: 'Task', href: '/capture/task', icon: { ios: 'checkmark.circle', android: 'check_circle_outline', web: 'check_circle_outline' } }, { label: 'Project action', href: '/capture/project-action', icon: { ios: 'arrow.forward', android: 'subdirectory_arrow_right', web: 'subdirectory_arrow_right' } },
  ];
  return (
    <AppBottomSheet visible={visible} onClose={onClose} title="Create" snapPoints={['48%', '68%']} initialSnapPointIndex={0}>
      <View>
        {options.map((option) => <Pressable key={option.href} accessibilityRole="button" accessibilityLabel={`Create ${option.label}`} onPress={() => onSelect(option.href)} style={({ pressed }) => [styles.option, { borderBottomColor: theme.colors.borderSubtle, opacity: pressed ? 0.68 : 1 }]}>
          <View style={styles.optionLabel}><SymbolView name={option.icon} size={19} tintColor={theme.colors.textSecondary} /><AppText variant="bodyStrong">{option.label}</AppText></View><AppText variant="meta">›</AppText>
        </Pressable>)}
      </View>
    </AppBottomSheet>
  );
}

type CalendarSource = { key: string; name: string; color: string; kind: 'ledger' | 'apple' | 'reminder'; readOnly?: boolean };

function sourceKeyForItem(item: MobileCalendarItem) {
  return item.sourceKey ?? `${item.sourceKind ?? 'calendar'}:${item.sourceName ?? item.sourceId ?? 'default'}`;
}

export function CalendarSourcesSheet({ visible, workspaceId, workspaceLabel, filters, onChangeFilters, onResetFilters, onOpenWorkspacePicker, onManageConnection, onClose }: { visible: boolean; workspaceId: string; workspaceLabel: string; filters: CalendarFilters; onChangeFilters: (patch: Partial<CalendarFilters>) => void; onResetFilters: () => void; onOpenWorkspacePicker?: () => void; onManageConnection?: () => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadSources = useCallback(() => {
    setLoading(true);
    setSyncError(null);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);
    void getMobileCalendarRange(workspaceId, start, end).then((payload) => {
      const normalized = normalizeCalendarRange(payload);
      const next: CalendarSource[] = (payload.calendars ?? []).map((calendar) => ({ key: `calendar:${String(calendar.id)}`, name: String(calendar.name ?? 'Calendar'), color: String(calendar.color ?? theme.colors.accent), kind: 'ledger' }));
      for (const item of normalized) {
        if (!item.sourceName || !item.sourceKey) continue;
        const kind = item.sourceKind === 'reminder' ? 'reminder' : item.type === 'external_event' ? 'apple' : 'ledger';
        if (kind === 'ledger' && item.calendarId) continue;
        if (!next.some((source) => source.key === sourceKeyForItem(item))) next.push({ key: sourceKeyForItem(item), name: item.sourceName, color: item.sourceColor ?? theme.colors.accent, kind, readOnly: item.readOnly });
      }
      setSources(next);
      setLoading(false);
    }).catch((error: unknown) => { setLoading(false); setSyncError(error instanceof Error ? 'Could not refresh calendars' : 'Could not refresh calendars'); });
  }, [theme.colors.accent, workspaceId]);

  useEffect(() => { if (visible) loadSources(); }, [loadSources, visible]);

  const toggleSource = (source: CalendarSource) => {
    const field = source.kind === 'reminder' ? 'visibleReminderListIds' : 'visibleCalendarIds';
    const current = filters[field];
    const all = sources.filter((candidate) => candidate.kind === source.kind).map((candidate) => candidate.key);
    const next = current.length === 0 ? all.filter((key) => key !== source.key) : current.includes(source.key) ? current.filter((key) => key !== source.key) : [...current, source.key];
    onChangeFilters({ [field]: next.length === all.length ? [] : next });
  };

  const isVisible = (source: CalendarSource) => { const field = source.kind === 'reminder' ? 'visibleReminderListIds' : 'visibleCalendarIds'; return filters[field].length === 0 || filters[field].includes(source.key); };
  const renderGroup = (title: string, kind: CalendarSource['kind']) => {
    const group = sources.filter((source) => source.kind === kind);
    if (!group.length) return null;
    const allVisible = group.every(isVisible);
    return <View style={styles.sourceGroup}><View style={styles.groupHeader}><AppText variant="meta">{title}</AppText><Pressable accessibilityRole="button" onPress={() => onChangeFilters({ [kind === 'reminder' ? 'visibleReminderListIds' : 'visibleCalendarIds']: allVisible ? group.map((source) => source.key) : [] })}><AppText variant="caption" style={{ color: theme.colors.accent }}>{allVisible ? 'Hide all' : 'Show all'}</AppText></Pressable></View>{group.map((source) => <Pressable key={source.key} accessibilityRole="checkbox" accessibilityState={{ checked: isVisible(source) }} accessibilityLabel={`${source.name} ${kind === 'reminder' ? 'reminder list' : 'calendar'}, ${isVisible(source) ? 'visible' : 'hidden'}${source.readOnly ? ', read only' : ''}`} onPress={() => toggleSource(source)} style={({ pressed }) => [styles.sourceRow, { borderBottomColor: theme.colors.borderSubtle, opacity: pressed ? 0.65 : isVisible(source) ? 1 : 0.48 }]}><View style={[styles.sourceDot, { backgroundColor: source.color }]} /><AppText variant="bodyStrong" numberOfLines={1} style={styles.sourceName}>{source.name}</AppText>{source.readOnly ? <AppText variant="caption" style={styles.readOnly}>Read only</AppText> : null}<AppText variant="meta">{isVisible(source) ? '✓' : '—'}</AppText></Pressable>)}</View>;
  };
  const typeRows: Array<[keyof CalendarFilters, string]> = [['showEvents', 'Events'], ['showReminders', 'Reminders'], ['showTasks', 'Tasks'], ['showProjectActions', 'Project actions'], ['showMilestones', 'Milestones'], ['showProjectDeadlines', 'Project deadlines']];
  const createCalendar = async () => { const name = newCalendarName.trim(); if (!name || creating) return; setCreating(true); try { const created = await createMobileCalendar(workspaceId, { name, color: theme.colors.accent }); setSources((current) => [...current, { key: `calendar:${String(created.id)}`, name, color: String(created.color ?? theme.colors.accent), kind: 'ledger' }]); setNewCalendarName(''); } finally { setCreating(false); } };

  return <AppBottomSheet visible={visible} onClose={onClose} title={<View><AppText variant="title">Calendars</AppText><AppText variant="caption">Choose what appears</AppText></View>} snapPoints={['58%', '88%']} initialSnapPointIndex={0}>
      <View style={styles.sourcesContent}><Pressable accessibilityRole="button" accessibilityLabel={`Calendar workspace, ${workspaceLabel}`} onPress={onOpenWorkspacePicker} style={styles.sheetActions}><AppText variant="meta">Workspace</AppText><AppText variant="bodyStrong" style={styles.sourceName}>{workspaceLabel}</AppText><AppText variant="meta">⌄</AppText>{JSON.stringify(filters) !== JSON.stringify(defaultCalendarFilters) ? <Pressable onPress={(event) => { event.stopPropagation(); onResetFilters(); }}><AppText variant="caption" style={{ color: theme.colors.accent }}>Reset</AppText></Pressable> : null}</Pressable>
      {renderGroup('Ledger calendars', 'ledger')}{renderGroup('Apple Calendar', 'apple')}{renderGroup('Apple Reminders', 'reminder')}
      <View style={styles.sourceGroup}><AppText variant="meta">Show in Calendar</AppText>{typeRows.map(([key, label]) => <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: filters[key] as boolean }} accessibilityLabel={`Show ${label.toLowerCase()} in Calendar, ${filters[key] ? 'enabled' : 'disabled'}`} onPress={() => onChangeFilters({ [key]: !filters[key] })} style={[styles.sourceRow, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="bodyStrong">{label}</AppText><AppText variant="meta" style={{ color: filters[key] ? theme.colors.accent : theme.colors.textMuted }}>{filters[key] ? '✓' : '—'}</AppText></Pressable>)}</View>
      {loading ? <AppText variant="caption" style={styles.status}>Syncing…</AppText> : syncError ? <View style={styles.statusRow}><AppText variant="caption">{syncError}</AppText><Pressable onPress={loadSources}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : <AppText variant="caption" style={styles.status}>Up to date</AppText>}
      <View style={styles.newCalendar}><AppText variant="meta">New Ledger calendar</AppText><View style={styles.createRow}><TextInput value={newCalendarName} onChangeText={setNewCalendarName} placeholder="Calendar name" placeholderTextColor={theme.colors.textMuted} style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.borderSubtle }]} /><Pressable accessibilityRole="button" onPress={() => void createCalendar()}><AppText variant="caption" style={{ color: theme.colors.accent }}>{creating ? 'Saving…' : 'Add'}</AppText></Pressable></View></View>
      <Pressable accessibilityRole="button" style={styles.manageAction} onPress={onManageConnection ?? onClose}><AppText variant="bodyStrong" style={{ color: theme.colors.accent }}>Manage Apple Calendar</AppText></Pressable>
    </View>
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  option: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionLabel: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sourceIntro: { gap: 4, paddingBottom: 12 },
  sourcesContent: { paddingBottom: 24 },
  sheetActions: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceGroup: { paddingTop: 16 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 },
  sourceRow: { minHeight: 46, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceName: { flex: 1 },
  readOnly: { color: '#8B735D' },
  sourceDot: { width: 8, height: 8, borderRadius: 4 },
  sourceStatus: { marginLeft: 'auto' },
  status: { paddingTop: 16 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 16 },
  newCalendar: { paddingTop: 20, gap: 8 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, minHeight: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10 },
  manageAction: { minHeight: 46, justifyContent: 'center', paddingTop: 8 },
});
