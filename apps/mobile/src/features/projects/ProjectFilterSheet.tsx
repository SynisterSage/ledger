import { Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { SymbolView } from 'expo-symbols';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type {
  ProjectAttentionFilter,
  ProjectDateFilter,
  ProjectFilterState,
  ProjectProgressFilter,
  ProjectSort,
  ProjectStatusFilter,
} from './projectFilters';

type ProjectFilterSheetProps = {
  visible: boolean;
  filters: ProjectFilterState;
  showOwnership?: boolean;
  activeCount: number;
  onChange: (filters: ProjectFilterState) => void;
  onReset: () => void;
  onClose: () => void;
};

const STATUS: Array<[ProjectStatusFilter, string]> = [['planned', 'Planned'], ['active', 'Active'], ['hold', 'On hold'], ['completed', 'Completed'], ['archived', 'Archived']];
const ATTENTION: Array<[ProjectAttentionFilter, string]> = [['attention', 'Needs attention'], ['overdue', 'Overdue'], ['missing_next_action', 'Missing next action'], ['blocked', 'Blocked'], ['stale', 'Stale']];
const DATES: Array<[ProjectDateFilter, string]> = [['today', 'Due today'], ['week', 'Due this week'], ['month', 'Due this month'], ['none', 'No due date']];
const PROGRESS: Array<[ProjectProgressFilter, string]> = [['not_started', 'Not started'], ['in_progress', 'In progress'], ['nearly_complete', 'Nearly complete'], ['complete', 'Complete']];
const SORTS: Array<[ProjectSort, string]> = [['attention', 'Attention first'], ['due', 'Due date'], ['updated', 'Recently updated'], ['progress', 'Progress'], ['name', 'Name']];

export function ProjectFilterSheet({ visible, filters, showOwnership = true, activeCount, onChange, onReset, onClose }: ProjectFilterSheetProps) {
  const theme = useLedgerTheme();
  const toggle = <T extends string>(key: 'status' | 'attention' | 'date' | 'progress', value: T) => {
    const values = filters[key] as T[];
    onChange({ ...filters, [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] } as ProjectFilterState);
  };
  const row = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.62 : 1 }]}>
      <AppText variant="body">{label}</AppText>
      {selected ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={17} tintColor={theme.colors.accent} /> : null}
    </Pressable>
  );
  return <AppBottomSheet visible={visible} onClose={onClose} snapPoints={['72%', '88%']} initialSnapPointIndex={0} title={<View style={styles.title}><AppText variant="sectionTitle">Filter projects</AppText>{activeCount ? <AppText variant="caption">{activeCount} active</AppText> : null}</View>} headerAccessory={<Pressable onPress={onReset} hitSlop={8}><AppText variant="caption" style={{ color: theme.colors.accent }}>Reset</AppText></Pressable>} contentStyle={{ gap: 18 }}>
    <FilterGroup title="Status">{STATUS.map(([value, label]) => row(label, filters.status.includes(value), () => toggle('status', value)))}</FilterGroup>
    <FilterGroup title="Attention">{ATTENTION.map(([value, label]) => row(label, filters.attention.includes(value), () => toggle('attention', value)))}</FilterGroup>
    {showOwnership ? <FilterGroup title="Ownership">{row('Mine', filters.ownership === 'mine', () => onChange({ ...filters, ownership: filters.ownership === 'mine' ? null : 'mine' }))}</FilterGroup> : null}
    <FilterGroup title="Date">{DATES.map(([value, label]) => row(label, filters.date.includes(value), () => toggle('date', value)))}</FilterGroup>
    <FilterGroup title="Progress">{PROGRESS.map(([value, label]) => row(label, filters.progress.includes(value), () => toggle('progress', value)))}</FilterGroup>
    <FilterGroup title="Sort">{SORTS.map(([value, label]) => row(label, filters.sort === value, () => onChange({ ...filters, sort: value })))}{filters.sort === 'progress' ? <Pressable onPress={() => onChange({ ...filters, progressDescending: !filters.progressDescending })} style={styles.direction}><AppText variant="caption">{filters.progressDescending ? 'Highest progress first' : 'Lowest progress first'}</AppText></Pressable> : null}</FilterGroup>
    <Pressable onPress={onClose} style={[styles.done, { backgroundColor: theme.colors.accent }]}><AppText variant="button" style={{ color: '#FFFFFF', textAlign: 'center' }}>Done</AppText></Pressable>
  </AppBottomSheet>;
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) { const theme = useLedgerTheme(); return <View style={styles.group}><AppText variant="label" style={{ color: theme.colors.textMuted, letterSpacing: 0.6 }}>{title}</AppText><View style={[styles.groupRows, { borderTopColor: theme.colors.borderSubtle }]}>{children}</View></View>; }

const styles = StyleSheet.create({ title: { flexDirection: 'row', alignItems: 'baseline', gap: 8 }, group: { gap: 7 }, groupRows: { borderTopWidth: StyleSheet.hairlineWidth }, row: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#00000012' }, direction: { paddingVertical: 6 }, done: { minHeight: 44, justifyContent: 'center', borderRadius: 9, marginTop: 2 }, });
