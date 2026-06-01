import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type RowProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
};

export function Row({ title, subtitle, right, onPress }: RowProps) {
  const theme = useLedgerTheme();

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          {
            borderBottomColor: theme.colors.borderSubtle,
            backgroundColor: pressed ? theme.colors.selectedSurface : 'transparent',
          },
        ]}>
        <View style={[styles.content, { paddingVertical: theme.spacing.md, gap: theme.spacing.lg }]}>
          <View style={[styles.textBlock, { gap: theme.spacing.xs }]}>
            <AppText variant="bodyStrong">{title}</AppText>
            {subtitle ? <AppText variant="meta">{subtitle}</AppText> : null}
          </View>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.borderSubtle }]}>
      <View style={[styles.content, { paddingVertical: theme.spacing.md, gap: theme.spacing.lg }]}>
        <View style={[styles.textBlock, { gap: theme.spacing.xs }]}>
          <AppText variant="bodyStrong">{title}</AppText>
          {subtitle ? <AppText variant="meta">{subtitle}</AppText> : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textBlock: {
    flex: 1,
  },
  right: {
    alignItems: 'flex-end',
  },
});
