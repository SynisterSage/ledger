import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type SettingsRowProps = {
  title: string;
  subtitle?: string;
  value?: string;
  right?: ReactNode;
  chevron?: boolean;
  destructive?: boolean;
  onPress?: () => void;
};

export function SettingsRow({
  title,
  subtitle,
  value,
  right,
  chevron = false,
  destructive = false,
  onPress,
}: SettingsRowProps) {
  const theme = useLedgerTheme();
  const Container = onPress ? Pressable : View;

  return (
    <Container
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.colors.borderSubtle, backgroundColor: 'transparent' }]}>
      <View style={[styles.content, { paddingVertical: theme.spacing.md, gap: theme.spacing.lg }]}>
        <View style={styles.textBlock}>
          <AppText
            variant="body"
            style={{ color: destructive ? theme.colors.danger : theme.colors.textPrimary }}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="meta" style={{ color: destructive ? theme.colors.danger : theme.colors.textSecondary }}>
              {subtitle}
            </AppText>
          ) : null}
        </View>

        <View style={styles.right}>
          {value ? <AppText variant="meta" style={destructive ? { color: theme.colors.danger } : undefined}>{value}</AppText> : null}
          {right}
          {chevron ? <AppText variant="meta" style={{ color: theme.colors.textMuted }}>›</AppText> : null}
        </View>
      </View>
    </Container>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
