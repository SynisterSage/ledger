import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type SectionProps = {
  title?: string;
  children: ReactNode;
};

export function Section({ title, children }: SectionProps) {
  const theme = useLedgerTheme();

  return (
    <View style={styles.container}>
      {title ? (
        <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
          <AppText variant="sectionTitle">{title}</AppText>
          <View style={[styles.divider, { backgroundColor: theme.colors.borderSubtle }]} />
        </View>
      ) : null}
      <View style={{ gap: theme.spacing.xs }}>{children}</View>
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
