import { Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

export type SettingsChoiceOption = { value: string; title: string; subtitle?: string };

type SettingsChoiceSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: SettingsChoiceOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  footer?: ReactNode;
};

export function SettingsChoiceSheet({ visible, title, subtitle, options, selectedValue, onSelect, onClose, footer }: SettingsChoiceSheetProps) {
  const theme = useLedgerTheme();

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title={title} snapPoints={['58%', '82%']} initialSnapPointIndex={1} maxHeight={500}>
      {subtitle ? <AppText variant="meta" style={{ marginBottom: theme.spacing.md }}>{subtitle}</AppText> : null}
      <View style={[styles.card, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle }]}>
        {options.map((option, index) => {
          const selected = option.value === selectedValue;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => { onSelect(option.value); onClose(); }}
              style={({ pressed }) => [
                styles.row,
                index < options.length - 1 && { borderBottomColor: theme.colors.borderSubtle, borderBottomWidth: 1 },
                { opacity: pressed ? 0.68 : 1 },
              ]}
            >
              <View style={styles.rowText}>
                <AppText variant="bodyStrong" style={selected ? { color: theme.colors.accent } : undefined}>{option.title}</AppText>
                {option.subtitle ? <AppText variant="meta">{option.subtitle}</AppText> : null}
              </View>
              {selected ? <AppText variant="bodyStrong" style={{ color: theme.colors.accent }}>✓</AppText> : null}
            </Pressable>
          );
        })}
      </View>
      {footer ? <View style={{ marginTop: theme.spacing.md }}>{footer}</View> : null}
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16 },
  row: { minHeight: 58, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowText: { flex: 1, gap: 2 },
});
