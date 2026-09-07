import { Pressable, StyleSheet, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

type SiriShortcutsSheetProps = { visible: boolean; onClose: () => void };

const shortcuts = [
  { title: "What's Today", subtitle: '“Hey Siri, what’s Today in Ledger?”' },
  { title: 'Add Reminder', subtitle: '“Hey Siri, add a Ledger reminder.”' },
  { title: 'Add Task', subtitle: '“Hey Siri, add a Ledger task.”' },
  { title: 'Create Event', subtitle: '“Hey Siri, create a Ledger event.”' },
  { title: 'Save Note', subtitle: '“Hey Siri, save a Ledger note.”' },
];

export function SiriShortcutsSheet({ visible, onClose }: SiriShortcutsSheetProps) {
  const theme = useLedgerTheme();
  return (
    <AppBottomSheet visible={visible} onClose={onClose} title="Siri Shortcuts" snapPoints={['62%', '94%']} initialSnapPointIndex={1} maxHeight={560}>
      <AppText variant="meta" style={{ marginBottom: theme.spacing.md }}>
        Preview the Siri phrases Ledger will support on iPhone.
      </AppText>
      <View style={[styles.card, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle }]}>
        {shortcuts.map((shortcut, index) => (
          <Pressable key={shortcut.title} accessibilityRole="button" style={({ pressed }) => [styles.row, index < shortcuts.length - 1 && { borderBottomColor: theme.colors.borderSubtle, borderBottomWidth: 1 }, { opacity: pressed ? 0.68 : 1 }]}>
            <View style={styles.rowText}>
              <AppText variant="bodyStrong">{shortcut.title}</AppText>
              <AppText variant="meta">{shortcut.subtitle}</AppText>
            </View>
          </Pressable>
        ))}
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16 },
  row: { minHeight: 58, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center' },
  rowText: { gap: 2 },
});
