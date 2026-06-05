import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type SectionProps = {
  title?: string;
  children: ReactNode;
  childrenGap?: number;
};

export function Section({ title, children, childrenGap }: SectionProps) {
  const theme = useLedgerTheme();

  return (
    <View style={styles.container}>
      {title ? (
        <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
          <AppText variant="sectionTitle">{title}</AppText>
          <View style={[styles.divider, { backgroundColor: theme.colors.borderSubtle }]} />
        </View>
      ) : null}
      <View style={{ gap: childrenGap ?? theme.spacing.xs }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
});
