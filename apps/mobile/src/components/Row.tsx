import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type RowProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  titleVariant?: 'body' | 'bodyStrong' | 'sectionTitle';
};

export function Row({
  title,
  subtitle,
  right,
  onPress,
  chevron = false,
  titleVariant = 'bodyStrong',
}: RowProps) {
  const theme = useLedgerTheme();

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          {
            borderBottomColor: theme.colors.borderSubtle,
            opacity: pressed ? 0.72 : 1,
          },
        ]}>
        <View style={[styles.content, { paddingVertical: theme.spacing.md, gap: theme.spacing.lg }]}>
          <View style={[styles.textBlock, { gap: theme.spacing.xs }]}>
            <AppText variant={titleVariant}>{title}</AppText>
            {subtitle ? <AppText variant="meta">{subtitle}</AppText> : null}
          </View>
          <View style={styles.right}>
            {right ? <View>{right}</View> : null}
            {chevron ? <AppText variant="meta" style={{ color: theme.colors.textMuted }}>›</AppText> : null}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.borderSubtle }]}>
      <View style={[styles.content, { paddingVertical: theme.spacing.md, gap: theme.spacing.lg }]}>
        <View style={[styles.textBlock, { gap: theme.spacing.xs }]}>
          <AppText variant={titleVariant}>{title}</AppText>
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
