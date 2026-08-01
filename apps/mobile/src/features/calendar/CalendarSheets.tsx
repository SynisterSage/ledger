import { Pressable, StyleSheet, View } from 'react-native';
import type { ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import type { MobileCalendarView } from './useMobileCalendarState';
import { useLedgerTheme } from '@/theme';

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

export function CalendarSourcesSheet({ visible, workspaceLabel, onClose }: { visible: boolean; workspaceLabel: string; onClose: () => void }) {
  const theme = useLedgerTheme();
  return <AppBottomSheet visible={visible} onClose={onClose} title="Calendars" snapPoints={['48%', '64%']} initialSnapPointIndex={0}>
    <View style={styles.sourceIntro}><AppText variant="meta">Sources for {workspaceLabel}</AppText><AppText variant="caption">Calendar source filtering will be available here as views are added.</AppText></View>
    {['Ledger events', 'Reminders', 'Tasks and project actions'].map((label) => <View key={label} style={[styles.sourceRow, { borderBottomColor: theme.colors.borderSubtle }]}><View style={[styles.sourceDot, { backgroundColor: theme.colors.accent }]} /><AppText variant="bodyStrong">{label}</AppText><AppText variant="meta" style={styles.sourceStatus}>Shown</AppText></View>)}
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  option: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionLabel: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sourceIntro: { gap: 4, paddingBottom: 12 },
  sourceRow: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceDot: { width: 8, height: 8, borderRadius: 4 },
  sourceStatus: { marginLeft: 'auto' },
});
