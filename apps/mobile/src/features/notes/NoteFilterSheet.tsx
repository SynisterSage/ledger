import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileNoteSection } from '@/api/notes';
import { countActiveNoteFilters, type NoteBrowseFilters, type NoteBrowseSort } from './noteBrowseTypes';

type NoteFilterSheetProps = {
  visible: boolean;
  filters: NoteBrowseFilters;
  sections: MobileNoteSection[];
  hasUnsorted: boolean;
  onChange: (filters: NoteBrowseFilters) => void;
  onReset: () => void;
  onClose: () => void;
};

function OptionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useLedgerTheme();
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.option, { opacity: pressed ? 0.68 : 1 }]}><AppText variant="body">{label}</AppText>{selected ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={18} tintColor={theme.colors.accent} /> : null}</Pressable>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const theme = useLedgerTheme();
  return <View style={styles.group}><AppText variant="label" style={styles.groupLabel}>{title}</AppText><View style={[styles.groupCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}>{children}</View></View>;
}

export function NoteFilterSheet({ visible, filters, sections, hasUnsorted, onChange, onReset, onClose }: NoteFilterSheetProps) {
  const theme = useLedgerTheme();
  const toggleType = (type: NoteBrowseFilters['types'][number]) => onChange({ ...filters, quick: 'all', types: filters.types.includes(type) ? filters.types.filter((value) => value !== type) : [...filters.types, type] });
  const setSort = (sort: NoteBrowseSort) => onChange({ ...filters, sort });

  return <AppBottomSheet visible={visible} onClose={onClose} snapPoints={['84%', '96%']} initialSnapPointIndex={0} title={<View><AppText variant="sectionTitle">Filter notes</AppText>{countActiveNoteFilters(filters) ? <AppText variant="caption">{countActiveNoteFilters(filters)} active</AppText> : null}</View>} headerAccessory={<Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} hitSlop={8}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={22} tintColor={theme.colors.accent} /></Pressable>}>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      {countActiveNoteFilters(filters) ? <Pressable accessibilityRole="button" onPress={onReset} hitSlop={8}><AppText variant="caption" style={{ color: theme.colors.accent }}>Reset filters</AppText></Pressable> : null}
      <Group title="Type"><OptionRow label="Text notes" selected={filters.types.includes('text')} onPress={() => toggleType('text')} /><OptionRow label="Meeting notes" selected={filters.types.includes('meeting_note')} onPress={() => toggleType('meeting_note')} /><OptionRow label="Mind maps" selected={filters.types.includes('mind_map')} onPress={() => toggleType('mind_map')} /></Group>
      <Group title="Organization"><OptionRow label="Root notes" selected={filters.organization === 'root'} onPress={() => onChange({ ...filters, organization: filters.organization === 'root' ? null : 'root' })} />{hasUnsorted ? <OptionRow label="Unsorted" selected={filters.organization === 'unsorted'} onPress={() => onChange({ ...filters, organization: filters.organization === 'unsorted' ? null : 'unsorted' })} /> : null}{sections.map((section) => <OptionRow key={section.id} label={section.name} selected={filters.sectionId === section.id} onPress={() => onChange({ ...filters, sectionId: filters.sectionId === section.id ? null : section.id })} />)}</Group>
      <Group title="Updated"><OptionRow label="Today" selected={filters.updated === 'today'} onPress={() => onChange({ ...filters, updated: filters.updated === 'today' ? null : 'today' })} /><OptionRow label="This week" selected={filters.updated === 'this_week'} onPress={() => onChange({ ...filters, updated: filters.updated === 'this_week' ? null : 'this_week' })} /><OptionRow label="This month" selected={filters.updated === 'this_month'} onPress={() => onChange({ ...filters, updated: filters.updated === 'this_month' ? null : 'this_month' })} /></Group>
      <Group title="Sort"><OptionRow label="Recently updated" selected={filters.sort === 'updated'} onPress={() => setSort('updated')} /><OptionRow label="Recently created" selected={filters.sort === 'created'} onPress={() => setSort('created')} /><OptionRow label="Title" selected={filters.sort === 'title'} onPress={() => setSort('title')} /><OptionRow label="Manual order" selected={filters.sort === 'manual'} onPress={() => setSort('manual')} /></Group>
    </ScrollView>
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  content: { gap: 22, paddingBottom: 24 },
  group: { gap: 2 },
  groupCard: { overflow: 'hidden', paddingVertical: 6 },
  groupLabel: { paddingBottom: 5, letterSpacing: 0.6 },
  option: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
