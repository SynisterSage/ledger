import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type SectionProps = {
  title?: string;
  children: ReactNode;
  childrenGap?: number;
  card?: boolean;
};

export function Section({ title, children, childrenGap, card = false }: SectionProps) {
  const theme = useLedgerTheme();

  return (
    <View style={styles.container}>
      {title ? (
        <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
          <AppText variant="sectionTitle">{title}</AppText>
          {!card ? <View style={[styles.divider, { backgroundColor: theme.colors.borderSubtle }]} /> : null}
        </View>
      ) : null}
      <View
        style={[
          { gap: card ? 0 : childrenGap ?? theme.spacing.xs },
          card && {
            overflow: 'hidden',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.borderSubtle,
            borderRadius: theme.radius.surface,
            backgroundColor: theme.colors.surfaceCard,
          },
        ]}
      >
        {children}
      </View>
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
